'use strict';

/**
 * routes/cartera.js
 *
 * Endpoint de cartera de clientes segmentada por estado.
 * TODOS los cálculos usan el mes calendario REAL del servidor (GETDATE).
 *
 *   Una sola consulta SQL devuelve el detalle de cada cliente con flags:
 *     EsActivo, EsInactivo, EsNuevo, EsRecuperado
 *
 *   Los KPIs numéricos (TotalClientes, ClientesActivos, ClientesInactivos,
 *   ClientesNuevos, ClientesRecuperados) se calculan en Node.js con filter().
 *
 *   Arrays de detalle para el frontend:
 *     total, activos, inactivos, nuevos, recuperados, activosMesActual
 *
 * 2026-06-10: refactor — reemplaza 5 queries por una sola consulta de detalle;
 *             KPIs y segmentos calculados en Node.js sobre el array resultante.
 * 2026-07-13: fix — EsRecuperado: cambia la ventana silenciosa de 90 a 180 días
 *             manteniendo la referencia en la primera compra del período
 *             filtrado (FechaMinMesActual):
 *               1. Tiene movimiento en el período filtrado.
 *               2. En los 180 días previos a la primera compra del período
 *                  no existen movimientos (ventana silenciosa).
 *               3. Existe al menos un movimiento anterior al corte de 180 días
 *                  (historial previo que confirma que no es cliente nuevo).
 *             Para casos con varias compras en el mismo mes se usa
 *             FechaMinMesActual (MIN de fecha en el mes actual) como referencia,
 *             no la última compra.
 */

const express             = require('express');
const router              = express.Router();
const sql                 = require('mssql');
const { requireAuth }     = require('../middlewares/requireAuth');
const db                  = require('../config/db');
const { getSoftlandPool } = require('../config/db.softland');
const { validarMesAnio }  = require('../utils/stringHelpers');

router.use(requireAuth);

function bindMssqlIn(request, valores, prefijo = 'cod') {
  return valores.map((valor, index) => {
    const name = `${prefijo}${index}`;
    request.input(name, sql.VarChar(20), String(valor));
    return `@${name}`;
  }).join(',');
}

async function getCodigosVendedor(usuarioId) {
  const [rows] = await db.pool.query(
    `SELECT cod_vendedor FROM usuario_vendedor WHERE usuario_id = ?`,
    [usuarioId]
  );
  return rows.map(r => r.cod_vendedor).filter(Boolean);
}

function buildPeriodoFiltro(mes, anio) {
  const mesNum = Number(mes);
  const anioNum = Number(anio);
  const desde = new Date(Date.UTC(anioNum, mesNum - 1, 1));
  const hasta = new Date(Date.UTC(anioNum, mesNum, 0));
  return {
    mes: mesNum,
    anio: anioNum,
    desde: desde.toISOString().slice(0, 10),
    hasta: hasta.toISOString().slice(0, 10),
  };
}

// ── GET /api/cartera ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const usuario = req.usuario;

  try {
    const hoy = new Date();
    let mes, anio;
    try {
      ({ mes, anio } = validarMesAnio(
        req.query.mes ?? (hoy.getMonth() + 1),
        req.query.anio ?? hoy.getFullYear()
      ));
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    const { desde, hasta } = buildPeriodoFiltro(mes, anio);
    const codigos = await getCodigosVendedor(usuario.sub);
    if (!codigos.length) {
      return res.json({
        ok: true,
        TotalClientes: 0, ClientesActivos: 0, ClientesInactivos: 0,
        ClientesNuevos: 0, ClientesRecuperados: 0,
        total: [], activos: [], inactivos: [], nuevos: [],
        recuperados: [], activosMesActual: []
      });
    }

    const pool      = await getSoftlandPool();
    const request   = pool.request();
    request.input('desde', sql.Date, desde);
    request.input('hasta', sql.Date, hasta);
    const inClause  = bindMssqlIn(request, codigos);

    // ── CONSULTA ÚNICA: detalle completo de cada cliente con flags de segmento ──
    //
    // Lógica EsRecuperado (3 condiciones):
    //   C1 — Tiene compra dentro del período filtrado.
    //   C2 — En la ventana [FechaMinPeriodo - 180 días, FechaMinPeriodo - 1 día]
    //        NO existe ninguna compra (silencio de 180 días exactos).
    //   C3 — Existe al menos una compra ANTERIOR a (FechaMinPeriodo - 180 días),
    //        confirmando que el cliente tiene historial previo (no es nuevo).
    const resDetalle = await request.query(`
      WITH Clientes AS (
          SELECT DISTINCT CodAux
          FROM [PRODIN].[softland].[cwtauxven]
          WHERE VenCod IN (${inClause})
      ),
      Compras AS (
          SELECT
              c.CodAux,
              g.Fecha
          FROM Clientes c
          LEFT JOIN [PRODIN].[softland].[iw_gsaen] g
              ON c.CodAux = g.CodAux
             AND g.CodVendedor IN (${inClause})
             AND g.Tipo IN ('F','N','D')
             AND g.Estado <> 'A'
             AND g.Fecha <= @hasta
      ),
      ResumenCompras AS (
          SELECT
              CodAux,
              -- Última compra hasta el período filtrado
              MAX(Fecha)  AS FechaUltimaCompra,
              -- Primera compra histórica hasta el período filtrado
              MIN(Fecha)  AS FechaPrimeraCompra,
              -- Primera compra dentro del período filtrado (referencia para C1, C2, C3)
              MIN(CASE
                  WHEN Fecha >= @desde
                   AND Fecha <= @hasta
                  THEN Fecha
              END) AS FechaMinMesActual
          FROM Compras
          GROUP BY CodAux
      )
      SELECT
          c.CodAux,
          RTRIM(a.NomAux)   AS NomAux,
          RTRIM(a.FonAux1)  AS FONAUX1,
          RTRIM(a.FonAux2)  AS FonAux2,
          RTRIM(a.EMail)    AS EMail,
          r.FechaUltimaCompra,
          r.FechaPrimeraCompra,
          r.FechaMinMesActual,

          -- EsActivo: última compra dentro de los últimos 90 días respecto al corte filtrado
          CASE
              WHEN r.FechaUltimaCompra >= DATEADD(DAY, -90, @hasta) THEN 1
              ELSE 0
          END AS EsActivo,

          -- EsInactivo: sin compras en los últimos 90 días (o sin compras)
          CASE
              WHEN r.FechaUltimaCompra < DATEADD(DAY, -90, @hasta)
                   OR r.FechaUltimaCompra IS NULL THEN 1
              ELSE 0
          END AS EsInactivo,

          -- EsNuevo: primera compra histórica está en el período filtrado
          CASE
              WHEN r.FechaPrimeraCompra >= @desde
               AND r.FechaPrimeraCompra <= @hasta THEN 1
              ELSE 0
          END AS EsNuevo,

          -- EsRecuperado: las 3 condiciones
          --   C1: tiene compra en el período filtrado (FechaMinMesActual IS NOT NULL)
          --   C2: NO tiene compras en los 180 días previos a FechaMinMesActual
          --       es decir, ninguna compra en [FechaMinMesActual-180d, FechaMinMesActual-1d]
          --   C3: SÍ tiene al menos una compra anterior a (FechaMinMesActual - 180 días)
          --       (confirma que existe historial: no es cliente nuevo)
          CASE
              WHEN r.FechaMinMesActual IS NOT NULL
               AND NOT EXISTS (
                   SELECT 1
                   FROM [PRODIN].[softland].[iw_gsaen] x
                   WHERE x.CodAux       = c.CodAux
                     AND x.CodVendedor IN (${inClause})
                     AND x.Tipo        IN ('F','N','D')
                     AND x.Estado      <> 'A'
                     AND x.Fecha       <= @hasta
                     AND x.Fecha       >= DATEADD(DAY, -180, r.FechaMinMesActual)
                     AND x.Fecha        < r.FechaMinMesActual
               )
               AND EXISTS (
                   SELECT 1
                   FROM [PRODIN].[softland].[iw_gsaen] y
                   WHERE y.CodAux       = c.CodAux
                     AND y.CodVendedor IN (${inClause})
                     AND y.Tipo        IN ('F','N','D')
                     AND y.Estado      <> 'A'
                     AND y.Fecha       <= @hasta
                     AND y.Fecha        < DATEADD(DAY, -180, r.FechaMinMesActual)
               )
              THEN 1
              ELSE 0
          END AS EsRecuperado,

          -- EsActivoMesActual: última compra dentro del período filtrado
          CASE
              WHEN r.FechaUltimaCompra >= @desde
               AND r.FechaUltimaCompra <= @hasta THEN 1
              ELSE 0
          END AS EsActivoMesActual

      FROM ResumenCompras r
      INNER JOIN [PRODIN].[softland].[cwtauxi] a
          ON a.CodAux = r.CodAux
      INNER JOIN Clientes c
          ON c.CodAux = r.CodAux
      ORDER BY c.CodAux;
    `);

    const todos = resDetalle.recordset || [];

    // ── Segmentos (arrays para las tablas expandibles del frontend) ──────────
    const total            = todos;
    const activos          = todos.filter(r => r.EsActivo          === 1);
    const inactivos        = todos.filter(r => r.EsInactivo        === 1);
    const nuevos           = todos.filter(r => r.EsNuevo           === 1);
    const recuperados      = todos.filter(r => r.EsRecuperado      === 1);
    const activosMesActual = todos.filter(r => r.EsActivoMesActual === 1);

    // ── KPIs numéricos (conteos) ─────────────────────────────────────────────
    const TotalClientes       = total.length;
    const ClientesActivos     = activos.length;
    const ClientesInactivos   = inactivos.length;
    const ClientesNuevos      = nuevos.length;
    const ClientesRecuperados = recuperados.length;

    res.json({
      ok: true,
      // KPIs numéricos para las cards del dashboard
      TotalClientes,
      ClientesActivos,
      ClientesInactivos,
      ClientesNuevos,
      ClientesRecuperados,
      // Arrays de detalle para las tablas expandibles
      total,
      activos,
      inactivos,
      nuevos,
      recuperados,
      activosMesActual
    });

  } catch (err) {
    console.error('[cartera] Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
