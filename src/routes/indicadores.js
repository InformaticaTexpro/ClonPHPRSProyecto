'use strict';

/**
 * indicadores.js — Dólar observado y UF
 *
 * Fuente primaria : Banco Central de Chile (si3.bcentral.cl)
 *   Requiere BCCH_USER y BCCH_PASS en .env
 *
 * Fuente fallback : mindicador.cl/api/{indicador}
 *
 * NODE_TLS_REJECT_UNAUTHORIZED=0 se setea en package.json scripts
 * para resolver el problema de certificados en Windows/Node 20.
 *
 * Caché: 30 minutos.
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');
const https   = require('https');
const router  = express.Router();

const CACHE_TTL_MS = 30 * 60 * 1000;
let cache   = null;
let cacheTS = 0;

// ─── HTTP helper ──────────────────────────────────────────────────────────────
function fetchJson(url, reintentos = 3) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname           : u.hostname,
      port               : u.port || 443,
      path               : u.pathname + u.search,
      method             : 'GET',
      rejectUnauthorized : false,
      headers: {
        'User-Agent': 'RSProyecto/1.0',
        'Accept'    : 'application/json',
      },
    };

    const req = https.request(opts, (res) => {
      if ([301,302,307,308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        fetchJson(res.headers.location, reintentos).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        if (!raw.startsWith('{') && !raw.startsWith('[')) {
          return reject(new Error('No-JSON: ' + raw.substring(0, 120)));
        }
        try   { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('JSON inválido: ' + e.message)); }
      });
    });

    req.setTimeout(12000, () => req.destroy(new Error('timeout')));
    req.on('error', async (err) => {
      if (reintentos > 1) {
        await new Promise(r => setTimeout(r, 1000));
        fetchJson(url, reintentos - 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
    req.end();
  });
}

// ─── Banco Central ────────────────────────────────────────────────────────────
async function fetchBCCH(serie) {
  const user = (process.env.BCCH_USER || '').trim();
  const pass = (process.env.BCCH_PASS || '').trim();
  if (!user || !pass) throw new Error('BCCH_USER/BCCH_PASS no configurados');

  const hoy    = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const inicio = new Date(Date.now() - 10 * 86400000)
                   .toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

  // IMPORTANTE: los parámetros van en el query string, NO en el body
  const qs = `function=GetSeries&user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}&timeseries=${serie}&firstdate=${inicio}&lastdate=${hoy}`;
  const url = `https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx?${qs}`;

  const data = await fetchJson(url);

  if (data?.Codigo !== 200) {
    throw new Error(`BCCH error ${data?.Codigo}: ${data?.Descripcion ?? JSON.stringify(data).substring(0,80)}`);
  }

  const obs = (data?.Series?.Obs ?? []).filter(o => o.value && o.value !== 'NaN');
  if (!obs.length) throw new Error('BCCH: sin observaciones válidas');

  const ult = obs.at(-1);
  return { valor: parseFloat(ult.value), fecha: ult.indexDateString };
}

// ─── mindicador.cl ────────────────────────────────────────────────────────────
async function fetchMindicador(indicador) {
  const data  = await fetchJson(`https://mindicador.cl/api/${indicador}`);
  const serie = data?.serie;
  if (!Array.isArray(serie) || !serie.length) throw new Error(`Sin serie: ${indicador}`);
  const ult = serie[0];
  if (ult?.valor == null) throw new Error(`Valor null: ${indicador}`);
  return {
    valor: ult.valor,
    fecha: String(ult.fecha ?? '').substring(0, 10),
  };
}

// ─── Orquestador ──────────────────────────────────────────────────────────────
async function obtenerIndicadores() {
  const ahora = Date.now();
  if (cache && (ahora - cacheTS) < CACHE_TTL_MS) return cache;

  let dolar, uf, fuente;

  try {
    [dolar, uf] = await Promise.all([
      fetchBCCH('F073.TCO.PRE.Z.D'),
      fetchBCCH('F073.UF.PRE.Z.D'),
    ]);
    fuente = 'Banco Central de Chile';
    console.log(`[indicadores] OK — Fuente: ${fuente} | Dólar: ${dolar.valor} | UF: ${uf.valor}`);
  } catch (eBCCH) {
    console.warn(`[indicadores] BCCH falló: ${eBCCH.message} — usando mindicador.cl`);
    try {
      [dolar, uf] = await Promise.all([
        fetchMindicador('dolar'),
        fetchMindicador('uf'),
      ]);
      fuente = 'mindicador.cl';
      console.log(`[indicadores] OK — Fuente: ${fuente} | Dólar: ${dolar.valor} | UF: ${uf.valor}`);
    } catch (eMind) {
      console.error(`[indicadores] Ambas fuentes fallaron | BCCH: ${eBCCH.message} | mindicador: ${eMind.message}`);
      throw new Error('Sin fuente disponible');
    }
  }

  cache = { ok: true, dolar, uf, fuente, actualizadoEn: new Date().toISOString() };
  cacheTS = ahora;
  return cache;
}

// ─── Endpoint ─────────────────────────────────────────────────────────────────
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
