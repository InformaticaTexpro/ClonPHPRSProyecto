'use strict';

/**
 * indicadores.js — Dólar observado y UF del día
 *
 * Fuente: mindicador.cl/api  (endpoint único con todos los indicadores diarios)
 * Documentación: https://mindicador.cl
 *
 * Caché interno: 5 minutos.
 * Endpoint: GET /api/indicadores
 * Respuesta: { ok, dolar: { valor, fecha }, uf: { valor, fecha }, actualizadoEn }
 */

const express = require('express');
const https   = require('https');
const router  = express.Router();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
let cache   = null;
let cacheTS = 0;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: { 'User-Agent': 'RSProyecto/1.0' },
      rejectUnauthorized: false, // workaround SSL schannel Windows
    }, (res) => {
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

  // mindicador.cl/api devuelve todos los indicadores del día en un solo objeto:
  // { dolar: { valor, fecha }, uf: { valor, fecha }, euro: {...}, ... }
  const data = await fetchJson('https://mindicador.cl/api');

  cache = {
    ok: true,
    dolar: {
      valor: data?.dolar?.valor ?? null,
      fecha: data?.dolar?.fecha ?? null,
    },
    uf: {
      valor: data?.uf?.valor ?? null,
      fecha: data?.uf?.fecha ?? null,
    },
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
