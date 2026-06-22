'use strict';

/**
 * indicadores.js — Dólar observado y UF
 *
 * Fuente primaria : Banco Central de Chile (si3.bcentral.cl)
 *   Requiere BCCH_USER y BCCH_PASS en .env
 *   Series: F073.TCO.PRE.Z.D (Dólar) / F073.UF.PRE.Z.D (UF)
 *
 * Fuente fallback : mindicador.cl/api/{indicador}
 *   Sin credenciales. Usa TLS agent permisivo para evitar problemas
 *   de certificados intermedios en Windows (schannel).
 *
 * Caché: 30 minutos.
 * Endpoint : GET /api/indicadores
 * Respuesta: { ok, dolar:{valor,fecha}, uf:{valor,fecha}, fuente, actualizadoEn }
 */

const express   = require('express');
const https     = require('https');
const router    = express.Router();

// Agente TLS reutilizable que deshabilita verificación de certificado.
// Necesario en Windows con Node 20 porque el store SChannel no incluye
// algunos certificados intermedios de Let's Encrypt / mindicador.
const tlsAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
});

const CACHE_TTL_MS = 30 * 60 * 1000;
let cache   = null;
let cacheTS = 0;

// ─── HTTP helper con reintentos ───────────────────────────────────────────
function fetchJson(url, intentos = 3) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port    : parsedUrl.port || 443,
      path    : parsedUrl.pathname + parsedUrl.search,
      method  : 'GET',
      agent   : tlsAgent,
      headers : {
        'User-Agent' : 'RSProyecto/1.0 (Texpro)',
        'Accept'     : 'application/json',
        'Connection' : 'keep-alive',
      },
    };

    const req = https.request(options, (res) => {
      // Seguir redirecciones
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        fetchJson(res.headers.location, intentos).then(resolve).catch(reject);
        return;
      }

      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        if (!raw.startsWith('{') && !raw.startsWith('[')) {
          return reject(new Error('No es JSON: ' + raw.substring(0, 100)));
        }
        try   { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('JSON inválido: ' + e.message)); }
      });
    });

    req.setTimeout(12000, () => {
      req.destroy(new Error('timeout'));
    });

    req.on('error', async (err) => {
      if (intentos > 1) {
        // Esperar 800 ms y reintentar
        await new Promise(r => setTimeout(r, 800));
        fetchJson(url, intentos - 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });

    req.end();
  });
}

// ─── Fuente 1: Banco Central de Chile ──────────────────────────────────────
function fechaStr(d) {
  // Devuelve 'YYYY-MM-DD' de la fecha de hoy en zona Santiago
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}

async function fetchBCCH(serie) {
  const user = (process.env.BCCH_USER || '').trim();
  const pass = (process.env.BCCH_PASS || '').trim();
  if (!user || !pass) throw new Error('BCCH_USER/BCCH_PASS no configurados');

  const hoy    = fechaStr(new Date());
  // Pedir los últimos 10 días para capturar el último valor hábil disponible
  const inicio = fechaStr(new Date(Date.now() - 10 * 86400000));

  const params = new URLSearchParams({
    user,
    pass,
    firstdate  : inicio,
    lastdate   : hoy,
    timeseries : serie,
    function   : 'GetSeries',
  });

  const url  = `https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx?${params}`;
  const data = await fetchJson(url);

  if (data?.Codigo !== 200) {
    throw new Error(`BCCH error ${data?.Codigo}: ${data?.Descripcion ?? JSON.stringify(data)}`);
  }

  const obs = data?.Series?.Obs;
  if (!Array.isArray(obs) || obs.length === 0) throw new Error('BCCH: sin observaciones');

  // El último elemento es el más reciente
  const ult = obs.filter(o => o.value !== 'NaN' && o.value != null).at(-1);
  if (!ult) throw new Error('BCCH: todos los valores son NaN');

  return {
    valor: parseFloat(ult.value),
    fecha: ult.indexDateString,
  };
}

// ─── Fuente 2: mindicador.cl (fallback) ────────────────────────────────────
async function fetchMindicador(indicador) {
  const data  = await fetchJson(`https://mindicador.cl/api/${indicador}`);
  const serie = data?.serie;
  if (!Array.isArray(serie) || serie.length === 0) throw new Error(`Sin serie para ${indicador}`);
  const ult = serie[0];
  if (ult?.valor == null) throw new Error(`Valor null para ${indicador}`);
  const fechaRaw = ult.fecha ?? '';
  return {
    valor: ult.valor,
    fecha: String(fechaRaw).substring(0, 10),
  };
}

// ─── Orquestador con fallback ───────────────────────────────────────────────
async function obtenerIndicadores() {
  const ahora = Date.now();
  if (cache && (ahora - cacheTS) < CACHE_TTL_MS) return cache;

  let dolar, uf, fuente;

  // Intento 1 — Banco Central
  try {
    [dolar, uf] = await Promise.all([
      fetchBCCH('F073.TCO.PRE.Z.D'),
      fetchBCCH('F073.UF.PRE.Z.D'),
    ]);
    fuente = 'Banco Central de Chile';
    console.log('[indicadores] Fuente: Banco Central — Dólar:', dolar.valor, '| UF:', uf.valor);
  } catch (eBCCH) {
    console.warn('[indicadores] BCCH falló:', eBCCH.message, '— usando mindicador.cl');

    // Intento 2 — mindicador.cl
    try {
      [dolar, uf] = await Promise.all([
        fetchMindicador('dolar'),
        fetchMindicador('uf'),
      ]);
      fuente = 'mindicador.cl (fallback)';
      console.log('[indicadores] Fuente: mindicador — Dólar:', dolar.valor, '| UF:', uf.valor);
    } catch (eMind) {
      console.error('[indicadores] Ambas fuentes fallaron. BCCH:', eBCCH.message, '| mindicador:', eMind.message);
      throw new Error('Sin fuente disponible');
    }
  }

  cache = { ok: true, dolar, uf, fuente, actualizadoEn: new Date().toISOString() };
  cacheTS = ahora;
  return cache;
}

// ─── Endpoint ───────────────────────────────────────────────────────────────
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
