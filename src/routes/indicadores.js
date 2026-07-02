'use strict';

/**
 * indicadores.js — Dólar observado y UF
 *
 * Fuente única: findic.cl
 * - Mantiene caché por 30 minutos.
 * - Si findic.cl falla y existe caché, devuelve stale:true.
 * - Si no hay caché, responde disponible:false sin provocar 502.
 */

const express = require('express');
const https = require('https');

const router = express.Router();

const CACHE_TTL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const FETCH_REINTENTOS = 2;

let cache = null;
let cacheTS = 0;

const tlsAgent = new https.Agent({ keepAlive: true });

function respuestaNoDisponible() {
  return {
    ok: true,
    disponible: false,
    dolar: null,
    uf: null,
    fuente: 'findic.cl',
    actualizadoEn: null,
    stale: false,
  };
}

function fetchJson(url, reintentos = FETCH_REINTENTOS) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'GET',
      agent: tlsAgent,
      headers: { 'User-Agent': 'RSProyecto/1.0', Accept: 'application/json' },
    };

    const req = https.request(opts, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : `https://${u.host}${res.headers.location}`;
        fetchJson(next, reintentos).then(resolve).catch(reject);
        return;
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        if (!raw.startsWith('{') && !raw.startsWith('[')) {
          return reject(new Error(`No-JSON(${res.statusCode}): ${raw.substring(0, 120)}`));
        }
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(new Error(`JSON inválido: ${err.message}`));
        }
      });
    });

    req.setTimeout(FETCH_TIMEOUT_MS, () => req.destroy(new Error('timeout')));
    req.on('error', async (err) => {
      if (reintentos > 1) {
        await new Promise(r => setTimeout(r, 750));
        fetchJson(url, reintentos - 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
    req.end();
  });
}

async function fetchFindic(indicador) {
  const data = await fetchJson(`https://findic.cl/api/${indicador}`);
  const serie = data?.serie;
  if (!Array.isArray(serie) || !serie.length) throw new Error(`Sin serie: ${indicador}`);
  const ult = serie[0];
  if (ult?.valor == null || Number.isNaN(Number(ult.valor))) throw new Error(`Valor null: ${indicador}`);
  return {
    valor: Number(ult.valor),
    fecha: String(ult.fecha ?? '').substring(0, 10),
  };
}

async function obtenerIndicadores() {
  const ahora = Date.now();
  if (cache && (ahora - cacheTS) < CACHE_TTL_MS) {
    return { ...cache, disponible: true, stale: false };
  }

  try {
    const [dolar, uf] = await Promise.all([
      fetchFindic('dolar'),
      fetchFindic('uf'),
    ]);

    cache = {
      ok: true,
      dolar,
      uf,
      fuente: 'findic.cl',
      actualizadoEn: new Date().toISOString(),
      disponible: true,
      stale: false,
    };
    cacheTS = ahora;
    return cache;
  } catch (err) {
    console.warn(`[indicadores] findic.cl falló: ${err.message}`);
    if (cache) {
      return { ...cache, disponible: true, stale: true };
    }
    return respuestaNoDisponible();
  }
}

router.get('/', async (_req, res) => {
  try {
    const data = await obtenerIndicadores();
    res.json(data);
  } catch (err) {
    console.error('[indicadores]', err.message);
    if (cache) {
      return res.json({ ...cache, disponible: true, stale: true });
    }
    res.json(respuestaNoDisponible());
  }
});

module.exports = router;
