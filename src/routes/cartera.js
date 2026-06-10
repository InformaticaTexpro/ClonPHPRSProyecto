'use strict';

/**
 * routes/cartera.js
 *
 * Endpoint de cartera de clientes segmentada por estado.
 * TODOS los cálculos usan el mes calendario REAL del servidor (GETDATE).
 *
 *   - TotalClientes, ClientesActivos, ClientesInactivos,
 *     ClientesNuevos, ClientesRecuperados: KPIs numéricos para las cards
 *   - activosMesActual:  compraron en el mes/año real del servidor (GETDATE)
 *   - inactivos:         clientes asignados al vendedor (cwtcvcl) que NO compraron este mes real
 *   - recuperados:       estuvieron inactivos y volvieron a comprar (últimos 90 días)
 *   - sinCompras:        clientes asignados sin ningún folio histórico
 *
 * 2026-06-09: fix — BaseClientes usa cwtcvcl+cwtauxven (universo real asignado)
 *                    para que el total coincida con los 968 clientes reales del vendedor
 * 2026-06-10: feat — agrega KPIs numéricos (TotalClientes, ClientesActivos,
 *                    ClientesInactivos, ClientesNuevos, ClientesRecuperados)
 *                    calculados con la consulta basada en cwtauxven + iw_gsaen
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
        activosMesActual: [], inactivos: [], recuperados: [], sinCompras: []
      });
    }

    const pool = await getSoftlandPool();
    const inClause = mssqlIn(codigos);

    // ── KPIs NUMÉRICOS ────────────────────────────────────────────────────────
    // Basado en cwtauxven (universo asignado) + iw_gsaen (historial de compras)
    const resKpis = await pool.request().query(`
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
          COUNT(*) AS TotalClientes,
          SUM(CASE
                  WHEN FechaUltimaCompra >= DATEADD(DAY, -90, GETDATE()) THEN 1
                  ELSE 0
              END) AS ClientesActivos,
          SUM(CASE
                  WHEN FechaUltimaCompra < DATEADD(DAY, -90, GETDATE())
                       OR FechaUltimaCompra IS NULL THEN 1
                  ELSE 0
              END) AS ClientesInactivos,
          SUM(CASE
                  WHEN FechaPrimeraCompra >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
                  THEN 1
                  ELSE 0
              END) AS ClientesNuevos,
          SUM(CASE
                  WHEN FechaUltimaCompra >= DATEADD(DAY, -180, GETDATE())
                   AND (FechaPenultimaCompra < DATEADD(DAY, -180, GETDATE())
                        OR FechaPenultimaCompra IS NULL)
                  THEN 1
                  ELSE 0
              END) AS ClientesRecuperados
      FROM UltimaCompra;
    `);

    const kpis = resKpis.recordset[0] || {};

    // ── ACTIVOS MES ACTUAL ────────────────────────────────────────────────────
    // Clientes que compraron en el mes calendario real (GETDATE), siempre fijo
    const resActivosMesActual = await pool.request().query(`
      SELECT
        h.CodAux                                  AS CodAux,
        MAX(RTRIM(c.NomAux))                      AS NomAux,
        MAX(RTRIM(c.FONAUX1))                     AS FONAUX1,
        MAX(RTRIM(c.FonAux2))                     AS FonAux2,
        MAX(RTRIM(c.EMail))                       AS EMail,
        COUNT(DISTINCT h.Folio)                   AS TotalCompras,
        MAX(h.Fecha)                              AS UltimaFactura
      FROM [PRODIN].[softland].[iw_gsaen] h
      INNER JOIN [PRODIN].[softland].[cwtauxi] c ON c.CodAux = h.CodAux
      WHERE h.CodVendedor IN (${inClause})
        AND h.Tipo IN ('F','N','D')
        AND h.Estado <> 'A'
        AND h.Fecha >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
        AND h.Fecha <  DATEADD(MONTH, 1, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
      GROUP BY h.CodAux
      ORDER BY MAX(h.Fecha) DESC
    `);

    // ── INACTIVOS ─────────────────────────────────────────────────────────────
    const resInactivos = await pool.request().query(`
      ;WITH BaseClientes AS (
        SELECT DISTINCT cl.CodAux
        FROM [PRODIN].[softland].[cwtcvcl] cl
        WHERE EXISTS (
          SELECT 1
          FROM [PRODIN].[softland].[cwtauxven] av
          WHERE av.CodAux = cl.CodAux
            AND av.VenCod IN (${inClause})
        )
      ),
      ActivosMesActual AS (
        SELECT DISTINCT CodAux
        FROM [PRODIN].[softland].[iw_gsaen]
        WHERE CodVendedor IN (${inClause})
          AND Tipo    IN ('F','N','D')
          AND Estado  <> 'A'
          AND Fecha   >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
          AND Fecha   <  DATEADD(MONTH, 1, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
      )
      SELECT
        c.CodAux,
        RTRIM(c.NomAux)                                         AS NomAux,
        RTRIM(c.FONAUX1)                                        AS FONAUX1,
        RTRIM(c.FonAux2)                                        AS FonAux2,
        RTRIM(c.EMail)                                          AS EMail,
        COUNT(DISTINCT h.Folio)                                 AS TotalCompras,
        MAX(h.Fecha)                                            AS UltimaCompra,
        CASE
          WHEN MAX(h.Fecha) IS NULL THEN NULL
          ELSE DATEDIFF(DAY, MAX(h.Fecha), GETDATE())
        END                                                     AS DiasInactivo
      FROM BaseClientes bc
      INNER JOIN [PRODIN].[softland].[cwtauxi] c
        ON c.CodAux = bc.CodAux
      LEFT JOIN [PRODIN].[softland].[iw_gsaen] h
        ON h.CodAux       = c.CodAux
       AND h.CodVendedor IN (${inClause})
       AND h.Tipo        IN ('F','N','D')
       AND h.Estado      <> 'A'
      WHERE bc.CodAux NOT IN (SELECT CodAux FROM ActivosMesActual)
      GROUP BY
        c.CodAux,
        RTRIM(c.NomAux),
        RTRIM(c.FONAUX1),
        RTRIM(c.FonAux2),
        RTRIM(c.EMail)
      ORDER BY
        CASE WHEN MAX(h.Fecha) IS NULL THEN 1 ELSE 0 END,
        DATEDIFF(DAY, MAX(h.Fecha), GETDATE()) ASC
    `);

    // ── RECUPERADOS ──────────────────────────────────────────────────────────
    const resRecuperados = await pool.request().query(`
      WITH FoliosOrdenados AS (
        SELECT
          h.CodAux,
          h.Folio,
          h.Fecha,
          ROW_NUMBER() OVER (PARTITION BY h.CodAux ORDER BY h.Fecha DESC, h.Folio DESC) AS RowNum
        FROM [PRODIN].[softland].[iw_gsaen] h
        WHERE h.CodVendedor IN (${inClause})
          AND h.Tipo IN ('F','N','D')
          AND h.Estado <> 'A'
      ),
      UltimoFolio AS (
        SELECT CodAux, Folio AS UltimoFolio, Fecha AS UltimaFecha
        FROM FoliosOrdenados WHERE RowNum = 1
      ),
      PenultimoFolio AS (
        SELECT CodAux, Folio AS PenultimoFolio, Fecha AS PenultimaFecha
        FROM FoliosOrdenados WHERE RowNum = 2
      ),
      TotalCompras AS (
        SELECT CodAux, COUNT(DISTINCT Folio) AS TotalFolios
        FROM [PRODIN].[softland].[iw_gsaen]
        WHERE CodVendedor IN (${inClause})
          AND Tipo IN ('F','N','D') AND Estado <> 'A'
        GROUP BY CodAux
      )
      SELECT
        cv.CodAux,
        RTRIM(c.NomAux)                                           AS NomAux,
        RTRIM(c.FONAUX1)                                          AS FONAUX1,
        RTRIM(c.FonAux2)                                          AS FonAux2,
        RTRIM(c.EMail)                                            AS EMail,
        tc.TotalFolios                                            AS TotalCompras,
        pf.PenultimoFolio,
        pf.PenultimaFecha                                         AS PenultimaFactura,
        uf.UltimoFolio,
        uf.UltimaFecha                                            AS UltimaFactura,
        DATEDIFF(DAY, pf.PenultimaFecha, uf.UltimaFecha)         AS DiasRecuperado
      FROM [PRODIN].[softland].[cwtauxven] cv
      INNER JOIN [PRODIN].[softland].[cwtauxi] c  ON c.CodAux  = cv.CodAux
      INNER JOIN UltimoFolio   uf ON uf.CodAux = cv.CodAux
      INNER JOIN PenultimoFolio pf ON pf.CodAux = cv.CodAux
      LEFT  JOIN TotalCompras   tc ON tc.CodAux = cv.CodAux
      WHERE cv.VenCod IN (${inClause})
        AND uf.UltimaFecha  >= DATEADD(DAY, -90, GETDATE())
        AND pf.PenultimaFecha < DATEADD(DAY, -90, GETDATE())
      ORDER BY DiasRecuperado DESC
    `);

    // ── SIN COMPRAS ──────────────────────────────────────────────────────────
    const resSinCompras = await pool.request().query(`
      SELECT
        cl.CodAux                             AS CodAux,
        RTRIM(c.NomAux)                       AS NomAux,
        RTRIM(c.FONAUX1)                      AS FONAUX1,
        RTRIM(c.FonAux2)                      AS FonAux2,
        RTRIM(c.EMail)                        AS EMail,
        'Sin compras registradas'             AS Estado
      FROM [PRODIN].[softland].[cwtcvcl] cl
      INNER JOIN [PRODIN].[softland].[cwtauxi] c ON c.CodAux = cl.CodAux
      WHERE EXISTS (
        SELECT 1
        FROM [PRODIN].[softland].[cwtauxven] av
        WHERE av.CodAux = cl.CodAux
          AND av.VenCod IN (${inClause})
      )
        AND NOT EXISTS (
          SELECT 1
          FROM [PRODIN].[softland].[iw_gsaen] h
          WHERE h.CodAux  = cl.CodAux
            AND h.Tipo    IN ('F','N','D')
            AND h.Estado <> 'A'
        )
      ORDER BY c.NomAux
    `);

    res.json({
      ok: true,
      // KPIs numéricos para las cards del dashboard
      TotalClientes:       kpis.TotalClientes       ?? 0,
      ClientesActivos:     kpis.ClientesActivos      ?? 0,
      ClientesInactivos:   kpis.ClientesInactivos    ?? 0,
      ClientesNuevos:      kpis.ClientesNuevos       ?? 0,
      ClientesRecuperados: kpis.ClientesRecuperados  ?? 0,
      // Arrays de detalle para las tablas expandibles
      activosMesActual: resActivosMesActual.recordset,
      inactivos:        resInactivos.recordset,
      recuperados:      resRecuperados.recordset,
      sinCompras:       resSinCompras.recordset
    });

  } catch (err) {
    console.error('[GET /api/cartera]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener cartera' });
  }
});

module.exports = router;
