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
 * 2026-06-11: fix — EsRecuperado: reemplaza lógica de 180d/FechaPenultima por
 *             las 3 condiciones correctas:
 *               1. Tiene movimiento en el mes actual.
 *               2. La primera compra del mes actual - 90 días: sin movimientos
 *                  en ese rango (ventana "silenciosa").
 *               3. Tiene al menos un movimiento anterior a ese corte de 90 días
 *                  (historial previo que confirma que no es cliente nuevo).
 *             Para casos con varias compras en el mismo mes se usa
 *             FechaMinMesActual (MIN de fecha en el mes actual) como referencia,
 *             no la última compra.
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
    //
    // Lógica EsRecuperado (3 condiciones):
    //   C1 — Tiene al menos una compra en el mes actual (año/mes de GETDATE).
    //   C2 — En la ventana [FechaMinMesActual - 90 días, FechaMinMesActual - 1 día]
    //        NO existe ninguna compra (silencio de 90 días).
    //        FechaMinMesActual = MIN(Fecha) del cliente en el mes actual,
    //        para manejar correctamente múltiples compras en el mismo mes.
    //   C3 — Existe al menos una compra ANTERIOR a (FechaMinMesActual - 90 días),
    //        confirmando que el cliente tiene historial previo (no es nuevo).
    const resDetalle = await pool.request().query(`
      WITH Clientes AS (
          SELECT CodAux
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
      ),
      ResumenCompras AS (
          SELECT
              CodAux,
              -- Última compra global
              MAX(Fecha)  AS FechaUltimaCompra,
              -- Primera compra global (para detectar cliente nuevo)
              MIN(Fecha)  AS FechaPrimeraCompra,
              -- Primera compra dentro del mes actual (referencia para C1, C2, C3)
              MIN(CASE
                  WHEN YEAR(Fecha)  = YEAR(GETDATE())
                   AND MONTH(Fecha) = MONTH(GETDATE())
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

          -- EsActivo: última compra dentro de los últimos 90 días
          CASE
              WHEN r.FechaUltimaCompra >= DATEADD(DAY, -90, GETDATE()) THEN 1
              ELSE 0
          END AS EsActivo,

          -- EsInactivo: sin compras en los últimos 90 días (o sin compras)
          CASE
              WHEN r.FechaUltimaCompra < DATEADD(DAY, -90, GETDATE())
                   OR r.FechaUltimaCompra IS NULL THEN 1
              ELSE 0
          END AS EsInactivo,

          -- EsNuevo: primera compra histórica está en el mes actual
          CASE
              WHEN r.FechaPrimeraCompra >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1) THEN 1
              ELSE 0
          END AS EsNuevo,

          -- EsRecuperado: las 3 condiciones
          --   C1: tiene compra en el mes actual (FechaMinMesActual IS NOT NULL)
          --   C2: NO tiene compras en los 90 días previos a FechaMinMesActual
          --       es decir, ninguna compra en [FechaMinMesActual-90d, FechaMinMesActual-1d]
          --   C3: SÍ tiene al menos una compra anterior a (FechaMinMesActual - 90 días)
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
                     AND x.Fecha       >= DATEADD(DAY, -90, r.FechaMinMesActual)
                     AND x.Fecha        < r.FechaMinMesActual
               )
               AND EXISTS (
                   SELECT 1
                   FROM [PRODIN].[softland].[iw_gsaen] y
                   WHERE y.CodAux       = c.CodAux
                     AND y.CodVendedor IN (${inClause})
                     AND y.Tipo        IN ('F','N','D')
                     AND y.Estado      <> 'A'
                     AND y.Fecha        < DATEADD(DAY, -90, r.FechaMinMesActual)
               )
              THEN 1
              ELSE 0
          END AS EsRecuperado,

          -- EsActivoMesActual: última compra dentro del mes actual
          CASE
              WHEN r.FechaUltimaCompra >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
               AND r.FechaUltimaCompra <  DATEADD(MONTH, 1, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)) THEN 1
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
