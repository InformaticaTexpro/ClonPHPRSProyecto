'use strict';

/**
 * routes/cartera.js
 *
 * Endpoint de cartera de clientes segmentada por estado.
 * TODOS los cálculos usan el mes calendario REAL del servidor (GETDATE).
 *
 *   - activosMesActual:  compraron en el mes/año real del servidor (GETDATE)
 *   - inactivos:         clientes históricos que NO compraron este mes real
 *   - recuperados:       estuvieron inactivos y volvieron a comprar (últimos 90 días)
 *   - sinCompras:        registrados sin ningún folio histórico
 *
 * 2026-06-09: fix — eliminado campo "activos" (selector), todo unificado a GETDATE()
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
      return res.json({ ok: true, activosMesActual: [], inactivos: [], recuperados: [], sinCompras: [] });
    }

    const pool = await getSoftlandPool();
    const inClause = mssqlIn(codigos);

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
    // Base: todos los clientes únicos históricos del vendedor
    // Condición: NO compraron en el mes real actual (GETDATE) — mismo universo que activosMesActual
    const resInactivos = await pool.request().query(`
      ;WITH BaseClientes AS (
        SELECT DISTINCT h.CodAux
        FROM [PRODIN].[softland].[iw_gsaen] h
        WHERE h.CodVendedor IN (${inClause})
          AND h.Tipo    IN ('F','N','D')
          AND h.Estado  <> 'A'
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
        DATEDIFF(DAY, MAX(h.Fecha), GETDATE())                  AS DiasInactivo
      FROM BaseClientes bc
      INNER JOIN [PRODIN].[softland].[cwtauxi] c
        ON c.CodAux = bc.CodAux
      INNER JOIN [PRODIN].[softland].[iw_gsaen] h
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
      ORDER BY DATEDIFF(DAY, MAX(h.Fecha), GETDATE()) ASC
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
        cv.CodAux                             AS CodAux,
        RTRIM(c.NomAux)                       AS NomAux,
        RTRIM(c.FONAUX1)                      AS FONAUX1,
        RTRIM(c.FonAux2)                      AS FonAux2,
        RTRIM(c.EMail)                        AS EMail,
        'Sin compras registradas'             AS Estado
      FROM [PRODIN].[softland].[cwtauxven] cv
      INNER JOIN [PRODIN].[softland].[cwtauxi] c ON c.CodAux = cv.CodAux
      WHERE cv.VenCod IN (${inClause})
        AND NOT EXISTS (
          SELECT 1
          FROM [PRODIN].[softland].[iw_gsaen] h
          WHERE h.CodAux   = cv.CodAux
            AND h.Tipo     IN ('F','N','D')
            AND h.Estado  <> 'A'
        )
      ORDER BY c.NomAux
    `);

    res.json({
      ok: true,
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
