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
 */

const express             = require('express');
const router              = express.Router();
const { requireAuth }     = require('../middlewares/requireAuth');
const db                  = require('../config/db');
const { getSoftlandPool } = require('../config/db.softland');

router.use(requireAuth);

function mssqlIn(arr) {
  return arr.map(v => `'${v}'`).join(',');
}

async function getCodigosVendedor(usuarioId) {
  const [rows] = await db.pool.query(
    `SELECT cod_vendedor FROM usuario_vendedor WHERE usuario_id = ?`,
    [usuarioId]
  );
  return rows.map(r => r.cod_vendedor).filter(Boolean);
}

// ── GET /api/cartera ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const usuario = req.usuario;

  try {
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
    const inClause  = mssqlIn(codigos);

    // ── CONSULTA ÚNICA: detalle completo de cada cliente con flags de segmento ──
    // Retorna una fila por cliente con:
    //   CodAux, NomAux, FonAux1, FonAux2, EMail,
    //   FechaUltimaCompra, FechaPrimeraCompra, FechaPenultimaCompra,
    //   EsActivo (0/1), EsInactivo (0/1), EsNuevo (0/1), EsRecuperado (0/1)
    const resDetalle = await pool.request().query(`
      WITH Clientes AS (
          SELECT CodAux
          FROM [PRODIN].[softland].[cwtauxven]
          WHERE VenCod IN (${inClause})
      ),
      Compras AS (
          SELECT
              c.CodAux,
              g.Fecha,
              ROW_NUMBER() OVER (
                  PARTITION BY c.CodAux
                  ORDER BY g.Fecha DESC
              ) AS rn_desc,
              ROW_NUMBER() OVER (
                  PARTITION BY c.CodAux
                  ORDER BY g.Fecha ASC
              ) AS rn_asc
          FROM Clientes c
          LEFT JOIN [PRODIN].[softland].[iw_gsaen] g
              ON c.CodAux = g.CodAux
             AND g.CodVendedor IN (${inClause})
             AND g.Tipo IN ('F','N','D')
             AND g.Estado <> 'A'
      ),
      UltimaCompra AS (
          SELECT
              CodAux,
              MAX(CASE WHEN rn_desc = 1 THEN Fecha END) AS FechaUltimaCompra,
              MAX(CASE WHEN rn_asc  = 1 THEN Fecha END) AS FechaPrimeraCompra,
              MAX(CASE WHEN rn_desc = 2 THEN Fecha END) AS FechaPenultimaCompra
          FROM Compras
          GROUP BY CodAux
      )
      SELECT
          c.CodAux,
          RTRIM(a.NomAux)   AS NomAux,
          RTRIM(a.FonAux1)  AS FONAUX1,
          RTRIM(a.FonAux2)  AS FonAux2,
          RTRIM(a.EMail)    AS EMail,
          u.FechaUltimaCompra,
          u.FechaPrimeraCompra,
          u.FechaPenultimaCompra,
          CASE
              WHEN u.FechaUltimaCompra >= DATEADD(DAY, -90, GETDATE()) THEN 1
              ELSE 0
          END AS EsActivo,
          CASE
              WHEN u.FechaUltimaCompra < DATEADD(DAY, -90, GETDATE())
                   OR u.FechaUltimaCompra IS NULL THEN 1
              ELSE 0
          END AS EsInactivo,
          CASE
              WHEN u.FechaPrimeraCompra >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1) THEN 1
              ELSE 0
          END AS EsNuevo,
          CASE
              WHEN u.FechaUltimaCompra >= DATEADD(DAY, -180, GETDATE())
               AND (u.FechaPenultimaCompra < DATEADD(DAY, -180, GETDATE())
                    OR u.FechaPenultimaCompra IS NULL) THEN 1
              ELSE 0
          END AS EsRecuperado,
          CASE
              WHEN u.FechaUltimaCompra >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
               AND u.FechaUltimaCompra <  DATEADD(MONTH, 1, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)) THEN 1
              ELSE 0
          END AS EsActivoMesActual
      FROM UltimaCompra u
      INNER JOIN [PRODIN].[softland].[cwtauxi] a
          ON a.CodAux = u.CodAux
      INNER JOIN Clientes c
          ON c.CodAux = u.CodAux
      ORDER BY c.CodAux;
    `);

    const todos = resDetalle.recordset || [];

    // ── Segmentos (arrays para las tablas expandibles del frontend) ──────────
    const total        = todos;
    const activos      = todos.filter(r => r.EsActivo      === 1);
    const inactivos    = todos.filter(r => r.EsInactivo    === 1);
    const nuevos       = todos.filter(r => r.EsNuevo       === 1);
    const recuperados  = todos.filter(r => r.EsRecuperado  === 1);
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
