'use strict';

/**
 * indicadores.js — Dólar y UF en tiempo real
 *
 * Fuente: mindicador.cl (API pública, sin autenticación)
 * Endpoint: GET /api/indicadores
 *
 * Respuesta:
 *   { ok: true, dolar: { valor, fecha }, uf: { valor, fecha }, actualizadoEn: ISO }
 *
 * Cache interno de 10 minutos para no saturar la API externa.
 */

const express = require('express');
const https   = require('https');
const router  = express.Router();

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos
let cache = null;
let cacheTS = 0;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'RSProyecto/1.0' } }, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('JSON inválido: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

async function obtenerIndicadores() {
  const ahora = Date.now();
  if (cache && (ahora - cacheTS) < CACHE_TTL_MS) return cache;

  const [dolarData, ufData] = await Promise.all([
    fetchJson('https://mindicador.cl/api/dolar'),
    fetchJson('https://mindicador.cl/api/uf'),
  ]);

  const serie = (d) => Array.isArray(d?.serie) && d.serie.length > 0 ? d.serie[0] : null;
  const dolarSerie = serie(dolarData);
  const ufSerie    = serie(ufData);

  cache = {
    ok: true,
    dolar: {
      valor: dolarSerie?.valor ?? null,
      fecha: dolarSerie?.fecha ?? null,
    },
    uf: {
      valor: ufSerie?.valor ?? null,
      fecha: ufSerie?.fecha ?? null,
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
    res.status(502).json({ ok: false, error: 'No se pudo obtener los indicadores económicos.' });
  }
});

module.exports = router;
