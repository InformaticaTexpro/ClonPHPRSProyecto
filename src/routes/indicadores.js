'use strict';

/**
 * indicadores.js — Dólar observado y UF del día
 *
 * Fuente primaria : Banco Central de Chile — si3.bcentral.cl/SieteRestWS
 *   Requiere BCCH_USER y BCCH_PASS en .env
 *   Registro gratuito en: https://si3.bcentral.cl/siete/
 *   Series utilizadas:
 *     F073.TCO.PRE.Z.D  → Dólar observado (diario)
 *     F073.UF.PRE.Z.D   → UF (diaria)
 *
 * Fuente fallback  : mindicador.cl/api/{indicador}/{YYYY-MM-DD}
 *   No requiere credenciales. Se usa si BCCH no está configurado
 *   o si la llamada al BCCH falla.
 *
 * Caché interno: 30 minutos.
 * Endpoint: GET /api/indicadores
 * Respuesta: { ok, dolar: { valor, fecha }, uf: { valor, fecha }, fuente, actualizadoEn }
 */

const express = require('express');
const https   = require('https');
const router  = express.Router();

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos
let cache   = null;
let cacheTS = 0;

// ─── Series del Banco Central ───────────────────────────────────────────────
const BCCH_BASE     = 'https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx';
const SERIE_DOLAR   = 'F073.TCO.PRE.Z.D';
const SERIE_UF      = 'F073.UF.PRE.Z.D';

// ─── HTTP helper ────────────────────────────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: { 'User-Agent': 'RSProyecto/1.0 (Texpro)' },
      rejectUnauthorized: false,
    }, (res) => {
      let raw = '';
      res.on('data', c  => { raw += c; });
      res.on('end',  () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('JSON inválido: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

// ─── Formateo de fecha ───────────────────────────────────────────────────────
/** Devuelve la fecha de hoy en formato YYYY-MM-DD (hora local Chile). */
function hoyStr() {
  const d = new Date();
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }); // 'YYYY-MM-DD'
}

/**
 * Devuelve los últimos N días hábiles hacia atrás como strings YYYY-MM-DD.
 * Se usan para buscar el último valor disponible si hoy no tiene dato todavía.
 */
function ultimosDias(n = 5) {
  const dias = [];
  const d    = new Date();
  while (dias.length < n) {
    const s = d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) dias.push(s); // excluir sábado y domingo
    d.setDate(d.getDate() - 1);
  }
  return dias;
}

// ─── Fuente 1: Banco Central ─────────────────────────────────────────────────
async function fetchBCCH(serie) {
  const user = process.env.BCCH_USER;
  const pass = process.env.BCCH_PASS;
  if (!user || !pass) throw new Error('BCCH_USER / BCCH_PASS no configurados');

  const hoy     = hoyStr();
  const hace5   = ultimosDias(5).at(-1); // hace ~5 días hábiles
  const params  = new URLSearchParams({
    user,
    pass,
    firstdate: hace5,
    lastdate:  hoy,
    timeseries: serie,
    function:  'GetSeries',
  });
  const url  = `${BCCH_BASE}?${params.toString()}`;
  const data = await fetchJson(url);

  if (data?.Codigo !== 200) {
    throw new Error(`BCCH error ${data?.Codigo}: ${data?.Descripcion}`);
  }

  // La serie viene ordenada ascendente; el último elemento es el más reciente.
  const obs = data?.Series?.Obs;
  if (!obs || !obs.length) throw new Error('Sin observaciones en BCCH');

  const ultimo = obs.at(-1);
  return {
    valor: parseFloat(ultimo.value),
    fecha: ultimo.indexDateString, // 'YYYY-MM-DD'
  };
}

// ─── Fuente 2: mindicador.cl por fecha (fallback) ───────────────────────────
async function fetchMindicadorFecha(indicador) {
  const dias = ultimosDias(5); // [hoy, ayer, anteayer, ...]
  for (const fecha of dias) {
    try {
      const url  = `https://mindicador.cl/api/${indicador}/${fecha}`;
      const data = await fetchJson(url);
      const serie = data?.serie;
      if (Array.isArray(serie) && serie.length > 0 && serie[0]?.valor) {
        return {
          valor: serie[0].valor,
          fecha,
        };
      }
    } catch (_) { /* intentar día anterior */ }
  }
  throw new Error(`mindicador: no se encontró valor para ${indicador}`);
}

// ─── Obtener indicadores con lógica de fallback ──────────────────────────────
async function obtenerIndicadores() {
  const ahora = Date.now();
  if (cache && (ahora - cacheTS) < CACHE_TTL_MS) return cache;

  let dolar, uf, fuente;

  // Intento 1: Banco Central
  try {
    [dolar, uf] = await Promise.all([
      fetchBCCH(SERIE_DOLAR),
      fetchBCCH(SERIE_UF),
    ]);
    fuente = 'Banco Central de Chile';
  } catch (errBCCH) {
    console.warn('[indicadores] BCCH falló, usando mindicador por fecha:', errBCCH.message);

    // Intento 2: mindicador.cl por fecha
    try {
      [dolar, uf] = await Promise.all([
        fetchMindicadorFecha('dolar'),
        fetchMindicadorFecha('uf'),
      ]);
      fuente = 'mindicador.cl (fallback)';
    } catch (errMind) {
      console.error('[indicadores] Ambas fuentes fallaron:', errMind.message);
      throw new Error('No se pudo obtener indicadores de ninguna fuente');
    }
  }

  cache = {
    ok: true,
    dolar,
    uf,
    fuente,
    actualizadoEn: new Date().toISOString(),
  };
  cacheTS = ahora;
  return cache;
}

// ─── Endpoint ────────────────────────────────────────────────────────────────
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
