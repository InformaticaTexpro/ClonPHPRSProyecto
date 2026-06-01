'use strict';

/**
 * routes/cartera.js
 *
 * Endpoint de cartera de clientes segmentada por estado:
 *   - activos:     compraron en los últimos 90 días
 *   - inactivos:   última compra entre 90 y 365 días
 *   - recuperados: estuvieron inactivos y volvieron a comprar
 *
 * Seguridad:
 *   - requireAuth: JWT obligatorio
 *   - El VenCod se obtiene desde usuario_vendedor (MySQL) haciendo
 *     match con los cod_vendedor del usuario logueado, evitando
 *     datos basura o de vendedores ajenos.
 *
 * Columnas devueltas (desde cwtauxi):
 *   activos:     CodAux, NomAux, FONAUX1, FonAux2, EMail, TotalCompras, UltimaFactura
 *   inactivos:   CodAux, NomAux, FONAUX1, FonAux2, EMail, TotalCompras, DiasInactivo
 *   recuperados: CodAux, NomAux, FONAUX1, FonAux2, EMail, TotalCompras, UltimaFactura, DiasRecuperado
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

/**
 * Obtiene los cod_vendedor del usuario logueado haciendo match
 * con la tabla usuario_vendedor de MySQL.
 * Retorna array de strings (códigos de Softland).
 */
async function getCodigosVendedor(usuarioId) {
  const [rows] = await db.pool.query(
    `SELECT cod_vendedor FROM usuario_vendedor WHERE usuario_id = ?`,
    [usuarioId]
  );
  return rows.map(r => r.cod_vendedor).filter(Boolean);
}

// ── GET /api/cartera ──────────────────────────────────────────────────────────
// Retorna: { ok, activos: [], inactivos: [], recuperados: [] }
router.get('/', async (req, res) => {
  const usuario = req.usuario;
  const { validarMesAnio } = require('../utils/stringHelpers');
  const hoy = new Date();
  let mes, anio;
  try {
    ({ mes, anio } = validarMesAnio(
      req.query.mes  ?? (hoy.getMonth() + 1),
      req.query.anio ?? hoy.getFullYear()
    ));
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }

  try {
    // 1. Obtener códigos de vendedor propios del usuario logueado
    const codigos = await getCodigosVendedor(usuario.sub);
    if (!codigos.length) {
      return res.json({ ok: true, activos: [], inactivos: [], recuperados: [] });
    }

    const pool = await getSoftlandPool();
    const inClause = mssqlIn(codigos);

    // ── ACTIVOS: compraron en el mes/año filtrado ─────────────────────────────
    // Columnas: CodAux, NomAux, FONAUX1, FonAux2, EMail, TotalCompras, UltimaFactura
    const resActivos = await pool.request().query(`
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
        AND h.Fecha >= DATEFROMPARTS(${anio}, ${mes}, 1)
        AND h.Fecha <  DATEADD(MONTH, 1, DATEFROMPARTS(${anio}, ${mes}, 1))
      GROUP BY h.CodAux
      ORDER BY MAX(h.Fecha) DESC
    `);

    // ── INACTIVOS: última compra hace más de 90 días (histórico, sin límite) ──
    // Excluye clientes que compraron en el mes/año filtrado
    // Columnas: CodAux, NomAux, FONAUX1, FonAux2, EMail, TotalCompras, DiasInactivo
    const resInactivos = await pool.request().query(`
      SELECT
        h.CodAux                                            AS CodAux,
        MAX(RTRIM(c.NomAux))                                AS NomAux,
        MAX(RTRIM(c.FONAUX1))                               AS FONAUX1,
        MAX(RTRIM(c.FonAux2))                               AS FonAux2,
        MAX(RTRIM(c.EMail))                                 AS EMail,
        COUNT(DISTINCT h.Folio)                             AS TotalCompras,
        DATEDIFF(DAY, MAX(h.Fecha), GETDATE())              AS DiasInactivo
      FROM [PRODIN].[softland].[iw_gsaen] h
      INNER JOIN [PRODIN].[softland].[cwtauxi] c ON c.CodAux = h.CodAux
      WHERE h.CodVendedor IN (${inClause})
        AND h.Tipo IN ('F','N','D')
        AND h.Estado <> 'A'
      GROUP BY h.CodAux
      HAVING
        MAX(h.Fecha) < DATEADD(DAY, -90, GETDATE())
        AND h.CodAux NOT IN (
          SELECT CodAux FROM [PRODIN].[softland].[iw_gsaen]
          WHERE CodVendedor IN (${inClause})
            AND Tipo IN ('F','N','D') AND Estado <> 'A'
            AND Fecha >= DATEFROMPARTS(${anio}, ${mes}, 1)
            AND Fecha <  DATEADD(MONTH, 1, DATEFROMPARTS(${anio}, ${mes}, 1))
        )
      ORDER BY DATEDIFF(DAY, MAX(h.Fecha), GETDATE()) ASC
    `);

    // ── RECUPERADOS: última compra dentro de 90 días, penúltima hace más de 90 ─
    // Columnas: CodAux, NomAux, FONAUX1, FonAux2, EMail, TotalCompras,
    //           PenultimoFolio, PenultimaFactura, UltimoFolio, UltimaFactura, DiasRecuperado
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

    // ── SIN COMPRAS: registrados en cwtauxven sin documentos válidos (F/N/D no anulados) ─
    // Columnas: CodAux, NomAux, FONAUX1, FonAux2, EMail, Estado
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
      activos:     resActivos.recordset,
      inactivos:   resInactivos.recordset,
      recuperados: resRecuperados.recordset,
      sinCompras:  resSinCompras.recordset
    });

  } catch (err) {
    console.error('[GET /api/cartera]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener cartera' });
  }
});

module.exports = router;
