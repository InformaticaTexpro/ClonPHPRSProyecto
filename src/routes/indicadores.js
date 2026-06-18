'use strict';

/**
 * indicadores.js — Dólar (mercado) y UF
 *
 * USD  → Se intenta en orden hasta obtener valor:
 *         1. api.frankfurter.app  (Banco Central Europeo, actualiza cada hora hábil)
 *         2. open.er-api.com      (fallback)
 * UF   → mindicador.cl/api/uf    (valor oficial diario)
 *
 * Caché interno: 5 minutos.
 * Endpoint: GET /api/indicadores
 */

const express = require('express');
const https   = require('https');
const router  = express.Router();

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache  = null;
let cacheTS = 0;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'RSProyecto/1.0' } }, (res) => {
      let raw = '';
      res.on('data',  c => { raw += c; });
      res.on('end',   () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('JSON inválido: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

/** Obtiene CLP por USD desde frankfurter.app (BCE) */
async function usdDesdefrankfurter() {
  // GET https://api.frankfurter.app/latest?from=USD&to=CLP
  // Responde: { base: 'USD', rates: { CLP: 892.33 }, date: '2026-06-18' }
  const data = await fetchJson('https://api.frankfurter.app/latest?from=USD&to=CLP');
  const valor = data?.rates?.CLP ?? null;
  if (!valor) throw new Error('frankfurter: sin valor CLP');
  return { valor, fecha: data.date ?? new Date().toISOString() };
}

/** Fallback: open.er-api.com */
async function usdDesdeER() {
  const data = await fetchJson('https://open.er-api.com/v6/latest/USD');
  const valor = data?.rates?.CLP ?? null;
  if (!valor) throw new Error('open.er-api: sin valor CLP');
  const fecha = data?.time_last_update_utc
    ? new Date(data.time_last_update_utc).toISOString()
    : new Date().toISOString();
  return { valor, fecha };
}

async function obtenerIndicadores() {
  const ahora = Date.now();
  if (cache && (ahora - cacheTS) < CACHE_TTL_MS) return cache;

  // USD con fallback
  let dolarResult;
  try {
    dolarResult = await usdDesdefrankfurter();
  } catch (e1) {
    console.warn('[indicadores] frankfurter falló, usando fallback:', e1.message);
    try {
      dolarResult = await usdDesdeER();
    } catch (e2) {
      console.error('[indicadores] ambas fuentes USD fallaron:', e2.message);
      dolarResult = { valor: null, fecha: null };
    }
  }

  // UF oficial
  let ufResult = { valor: null, fecha: null };
  try {
    const ufData = await fetchJson('https://mindicador.cl/api/uf');
    const s = Array.isArray(ufData?.serie) && ufData.serie.length > 0 ? ufData.serie[0] : null;
    ufResult = { valor: s?.valor ?? null, fecha: s?.fecha ?? null };
  } catch (e) {
    console.error('[indicadores] UF falló:', e.message);
  }

  cache = {
    ok: true,
    dolar: { ...dolarResult, fuente: 'mercado' },
    uf:    { ...ufResult,    fuente: 'oficial'  },
    actualizadoEn: new Date().toISOString(),
  };
  cacheTS = ahora;
  return cache;
}

router.get('/', async (_req, res) => {
  try {
    const data = await obtenerIndicadores();
    res.json(data);
  } catch (err) {
    console.error('[indicadores]', err.message);
    res.status(502).json({ ok: false, error: 'No se pudo obtener los indicadores económicos.' });
  }
});

module.exports = router;
