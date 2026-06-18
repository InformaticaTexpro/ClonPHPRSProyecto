'use strict';

/**
 * indicadores.js — Dólar (mercado) y UF
 *
 * USD  → v6.exchangerate-api.com (sin redirección, gratuita, sin API key)
 * UF   → mindicador.cl/api/uf  con SSL permisivo para compatibilidad Windows
 *
 * Caché interno: 5 minutos.
 * Endpoint: GET /api/indicadores
 */

const express = require('express');
const https   = require('https');
const http    = require('http');
const router  = express.Router();

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache   = null;
let cacheTS = 0;

/** Descarga JSON desde URL — soporta http y https, con opción de skip SSL */
function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const lib     = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers:  { 'User-Agent': 'RSProyecto/1.0' },
      ...options,
    };
    const req = lib.request(reqOpts, (res) => {
      // Seguir redirecciones 301/302 una vez
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        return fetchJson(res.headers.location, options).then(resolve).catch(reject);
      }
      let raw = '';
      res.on('data', c  => { raw += c; });
      res.on('end',  () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('JSON inválido: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function obtenerIndicadores() {
  const ahora = Date.now();
  if (cache && (ahora - cacheTS) < CACHE_TTL_MS) return cache;

  // --- USD (exchangerate-api.com — sin redirección, responde JSON directo) ---
  // GET https://open.er-api.com/v6/latest/USD
  // { rates: { CLP: 892.33, ... }, time_last_update_utc: '...' }
  let dolarResult = { valor: null, fecha: null };
  try {
    const usd = await fetchJson('https://open.er-api.com/v6/latest/USD');
    const valor = usd?.rates?.CLP ?? null;
    if (!valor) throw new Error('sin valor CLP');
    dolarResult = {
      valor,
      fecha: usd?.time_last_update_utc
        ? new Date(usd.time_last_update_utc).toISOString()
        : new Date().toISOString(),
    };
  } catch (e) {
    console.error('[indicadores] USD falló:', e.message);
  }

  // --- UF (mindicador.cl con rejectUnauthorized:false para SSL Windows) ---
  let ufResult = { valor: null, fecha: null };
  try {
    const uf = await fetchJson('https://mindicador.cl/api/uf', {
      rejectUnauthorized: false, // workaround SSL schannel Windows
    });
    const s = Array.isArray(uf?.serie) && uf.serie.length > 0 ? uf.serie[0] : null;
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
