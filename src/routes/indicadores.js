'use strict';

/**
 * indicadores.js — Dólar observado y UF
 *
 * Fuente: mindicador.cl/api/{indicador}  (sin fecha — devuelve serie completa)
 *   El elemento serie[0] es siempre el valor más reciente disponible.
 *   No requiere credenciales ni registro.
 *
 * Nota: si en el futuro se configuran BCCH_USER y BCCH_PASS en el .env,
 *   se puede reactivar la integración con el Banco Central de Chile.
 *
 * Caché interno: 30 minutos.
 * Endpoint : GET /api/indicadores
 * Respuesta: { ok, dolar: { valor, fecha }, uf: { valor, fecha }, fuente, actualizadoEn }
 */

const express = require('express');
const https   = require('https');
const router  = express.Router();

const CACHE_TTL_MS = 30 * 60 * 1000;
let cache   = null;
let cacheTS = 0;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method : 'GET',
      headers: { 'User-Agent': 'RSProyecto/1.0 (Texpro)' },
      // mindicador.cl puede tener certificado intermedio problemático en Windows
      rejectUnauthorized: false,
    }, (res) => {
      // Redireccionamiento 301/302 manual (por si acaso)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchJson(res.headers.location).then(resolve).catch(reject);
        res.resume();
        return;
      }
      let raw = '';
      res.on('data', c  => { raw += c; });
      res.on('end',  () => {
        if (!raw.trimStart().startsWith('{') && !raw.trimStart().startsWith('[')) {
          return reject(new Error('Respuesta no es JSON: ' + raw.substring(0, 80)));
        }
        try   { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('JSON inválido: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

async function fetchMindicador(indicador) {
  const data  = await fetchJson(`https://mindicador.cl/api/${indicador}`);
  const serie = data?.serie;
  if (!Array.isArray(serie) || serie.length === 0) {
    throw new Error(`Sin serie para ${indicador}`);
  }
  const ultimo = serie[0]; // el más reciente siempre está primero
  if (ultimo?.valor == null) throw new Error(`Valor null para ${indicador}`);
  return {
    valor: ultimo.valor,
    fecha: typeof ultimo.fecha === 'string' ? ultimo.fecha.substring(0, 10) : null,
  };
}

async function obtenerIndicadores() {
  const ahora = Date.now();
  if (cache && (ahora - cacheTS) < CACHE_TTL_MS) return cache;

  const [dolar, uf] = await Promise.all([
    fetchMindicador('dolar'),
    fetchMindicador('uf'),
  ]);

  cache = {
    ok: true,
    dolar,
    uf,
    fuente: 'mindicador.cl',
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
