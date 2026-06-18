'use strict';

/**
 * indicadores.js — Dólar (mercado) y UF en tiempo real
 *
 * USD  → open.er-api.com (tasa de mercado actualizada ~cada hora, sin API key)
 * UF   → mindicador.cl/api/uf  (valor oficial diario del día)
 *
 * Cache interno de 5 minutos para no saturar las APIs externas.
 *
 * Endpoint: GET /api/indicadores
 * Respuesta:
 *   { ok: true, dolar: { valor, fecha }, uf: { valor, fecha }, actualizadoEn: ISO }
 */

const express = require('express');
const https   = require('https');
const router  = express.Router();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
let cache  = null;
let cacheTS = 0;

/** Descarga y parsea JSON desde una URL HTTPS */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'RSProyecto/1.0' } }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end',  () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('JSON inválido: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

async function obtenerIndicadores() {
  const ahora = Date.now();
  if (cache && (ahora - cacheTS) < CACHE_TTL_MS) return cache;

  // USD: tasa de mercado en tiempo real (open.er-api.com — gratuita, sin API key)
  // Devuelve { base_code: 'USD', rates: { CLP: <valor>, ... }, time_last_update_utc: ... }
  const [usdData, ufData] = await Promise.all([
    fetchJson('https://open.er-api.com/v6/latest/USD'),
    fetchJson('https://mindicador.cl/api/uf'),
  ]);

  // --- Dólar (mercado) ---
  const clpRate = usdData?.rates?.CLP ?? null;
  const usdFecha = usdData?.time_last_update_utc
    ? new Date(usdData.time_last_update_utc).toISOString()
    : new Date().toISOString();

  // --- UF (oficial diaria) ---
  const ufSerie = Array.isArray(ufData?.serie) && ufData.serie.length > 0
    ? ufData.serie[0]
    : null;

  cache = {
    ok: true,
    dolar: {
      valor: clpRate,
      fecha: usdFecha,
      fuente: 'mercado', // distingue de dólar observado
    },
    uf: {
      valor: ufSerie?.valor ?? null,
      fecha: ufSerie?.fecha ?? null,
      fuente: 'oficial',
    },
    actualizadoEn: new Date().toISOString(),
  };
  cacheTS = ahora;
  return cache;
}

// GET /api/indicadores
router.get('/', async (_req, res) => {
  try {
    const data = await obtenerIndicadores();
    res.json(data);
  } catch (err) {
    console.error('[indicadores]', err.message);
    res.status(502).json({
      ok: false,
      error: 'No se pudo obtener los indicadores económicos.',
    });
  }
});

module.exports = router;
