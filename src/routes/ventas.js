'use strict';

/**
 * routes/ventas.js — API REST módulo de ventas
 *
 * GET /api/ventas                      — lista de folios del mes
 * GET /api/ventas/kpis                 — KPIs card
 * GET /api/ventas/total                — total ventas del mes
 * GET /api/ventas/resumen              — resumen por vendedor
 * GET /api/ventas/resumen-vendedores   — ventas agrupadas por cod_vendedor
 * GET /api/ventas/evolucion            — ventas mes a mes del año
 * GET /api/ventas/meta                 — meta anual/mensual
 * GET /api/ventas/clientes             — autocomplete de clientes (q=texto)
 * GET /api/ventas/cliente-info         — info completa del cliente: ?codAux=
 * GET /api/ventas/historial-cliente    — historial por cliente: ?codAux=&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 * GET /api/ventas/folio/:folio         — monto de un folio
 * GET /api/ventas/detalle/:folio       — detalle líneas de un folio
 * GET /api/ventas/descuentos           — descuentos por vendedor
 */

const express = require('express');
const router  = express.Router();
const sql     = require('mssql');

const { requireAuth }              = require('../middlewares/requireAuth');
const db                           = require('../config/db');
const { getSoftlandPool }          = require('../config/db.softland');
const { buildPrecioListaRealCASE } = require('../utils/precioHistorico');
const {
  getTotalVentas,
  getResumenPorVendedor,
  getClientesPorVendedor,
  getVentas,
  getMontoFolio,
  getDetalleFolio,
  getDescuentosVendedor,
} = require('../models/venta');
const { validarMesAnio } = require('../utils/stringHelpers');

/** Códigos de vendedor asignados al usuario autenticado. */
function getCodigos(req) {
  return (req.usuario?.vendedores ?? []).map(v => v.cod_vendedor).filter(Boolean);
}

/**
 * isAdmin — true si el usuario es administrador O no tiene vendedores asignados.
 * En ambos casos se omite el filtro por CodVendedor para que puedan ver
 * el historial/clientes de toda la cartera.
 */
function isAdmin(req) {
  return req.usuario?.is_admin === true || getCodigos(req).length === 0;
}

// GET /api/ventas
router.get('/', requireAuth, async (req, res) => {
  try {
    const codigos = getCodigos(req);
    if (!codigos.length) return res.json({ ok: true, ventas: [] });
    let mes, anio;
    try { ({ mes, anio } = validarMesAnio(req.query.mes, req.query.anio)); }
    catch (err) { return res.status(400).json({ ok: false, error: err.message }); }
    const ventas = await getVentas({ codigos, mes, anio });
    res.json({ ok: true, ventas });
  } catch (err) {
    console.error('[GET /api/ventas]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener ventas' });
  }
});

// GET /api/ventas/kpis
router.get('/kpis', requireAuth, async (req, res) => {
  try {
    const codigos = getCodigos(req);
    let mes, anio;
    try { ({ mes, anio } = validarMesAnio(req.query.mes, req.query.anio)); }
    catch (err) { return res.status(400).json({ ok: false, error: err.message }); }

    const usuarioId = req.usuario?.id;
    const [metaRows] = await db.query(
      `SELECT meta FROM vendedor_meta WHERE usuario_id = ? AND YEAR(fecha) = ? LIMIT 1`,
      [usuarioId, anio]
    );
    const metaAnual = metaRows.length ? Number(metaRows[0].meta) : 0;
    const metaMes   = metaAnual > 0 ? Math.round(metaAnual / 12) : 0;

    if (!codigos.length) return res.json({ ok: true, totalVentas: 0, metaMes, totalDescuento: 0 });

    const codigosIn = codigos.map(c => `'${c}'`).join(',');
    const precioListaRealCASE = await buildPrecioListaRealCASE(db, {
      campoFecha: 'enc.Fecha', campoCodProd: 'm.CodProd',
      campoTotLinea: 'm.TotLinea', campoCant: 'm.CantFacturada',
      campoPrecioVta: 't.PrecioVta', campoCodCan: 'cvl.CodCan',
    });

    const pool   = await getSoftlandPool();
    const result = await pool.request()
      .input('mes', sql.Int, mes).input('anio', sql.Int, anio)
      .query(`
        SELECT
          enc.CodVendedor,
          SUM(m.TotLinea)                                         AS totalVentasCobrado,
          SUM(m.CantFacturada * (${precioListaRealCASE}))         AS totalVentasLista
        FROM [PRODIN].[softland].[iw_gsaen] enc
        INNER JOIN [PRODIN].[softland].[iw_gmovi] m
          ON m.NroInt = enc.NroInt AND m.Tipo = enc.Tipo
        INNER JOIN [PRODIN].[softland].[iw_tprod] t ON t.CodProd = m.CodProd
        LEFT JOIN [PRODIN].[softland].[cwtcvcl] cvl ON cvl.CodAux = enc.CodAux
        WHERE enc.Tipo IN ('F','N','D') AND enc.Estado <> 'A'
          AND enc.CodVendedor IN (${codigosIn})
          AND MONTH(enc.Fecha) = @mes AND YEAR(enc.Fecha) = @anio
        GROUP BY enc.CodVendedor
      `);

    const rows           = result.recordset;
    const totalVentas    = rows.reduce((a, r) => a + Number(r.totalVentasCobrado || 0), 0);
    const totalLista     = rows.reduce((a, r) => a + Number(r.totalVentasLista   || 0), 0);
    const totalDescuento = Math.round(totalLista - totalVentas);

    res.json({ ok: true, totalVentas: Math.round(totalVentas), metaMes, totalDescuento });
  } catch (err) {
    console.error('[GET /api/ventas/kpis]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener KPIs' });
  }
});

// GET /api/ventas/total
router.get('/total', requireAuth, async (req, res) => {
  try {
    const codigos = getCodigos(req);
    if (!codigos.length) return res.json({ ok: true, total_ventas: 0 });
    let mes, anio;
    try { ({ mes, anio } = validarMesAnio(req.query.mes, req.query.anio)); }
    catch (err) { return res.status(400).json({ ok: false, error: err.message }); }
    const total = await getTotalVentas({ codigos, mes, anio });
    res.json({ ok: true, total_ventas: total });
  } catch (err) {
    console.error('[GET /api/ventas/total]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener total de ventas' });
  }
});

// GET /api/ventas/meta
router.get('/meta', requireAuth, async (req, res) => {
  try {
    let anio;
    try { ({ anio } = validarMesAnio(req.query.mes ?? '1', req.query.anio)); }
    catch (err) { return res.status(400).json({ ok: false, error: err.message }); }
    const usuarioId = req.usuario?.id;
    const [rows] = await db.query(
      `SELECT meta FROM vendedor_meta WHERE usuario_id = ? AND YEAR(fecha) = ? LIMIT 1`,
      [usuarioId, anio]
    );
    const metaAnual = rows.length ? Number(rows[0].meta) : 0;
    const metaMes   = metaAnual > 0 ? Math.round(metaAnual / 12) : 0;
    res.json({ ok: true, metaAnual, metaMes });
  } catch (err) {
    console.error('[GET /api/ventas/meta]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener meta' });
  }
});

// GET /api/ventas/resumen-vendedores
router.get('/resumen-vendedores', requireAuth, async (req, res) => {
  try {
    const codigos = getCodigos(req);
    if (!codigos.length) return res.json({ ok: true, vendedores: [] });
    let mes, anio;
    try { ({ mes, anio } = validarMesAnio(req.query.mes, req.query.anio)); }
    catch (err) { return res.status(400).json({ ok: false, error: err.message }); }

    const codigosIn = codigos.map(c => `'${c}'`).join(',');
    const precioListaRealCASE = await buildPrecioListaRealCASE(db, {
      campoFecha: 'enc.Fecha', campoCodProd: 'm.CodProd',
      campoTotLinea: 'm.TotLinea', campoCant: 'm.CantFacturada',
      campoPrecioVta: 't.PrecioVta', campoCodCan: 'cvl.CodCan',
    });

    const pool   = await getSoftlandPool();
    const result = await pool.request()
      .input('mes', sql.Int, mes).input('anio', sql.Int, anio)
      .query(`
        SELECT
          enc.CodVendedor                                                AS codVendedor,
          MIN(enc.NomAux)                                                AS nombreVendedor,
          COUNT(DISTINCT enc.Folio)                                      AS totalFolios,
          ROUND(SUM(m.TotLinea), 0)                                      AS totalVentasCobrado,
          ROUND(SUM(m.CantFacturada * (${precioListaRealCASE})), 0)      AS ventaRealLista,
          CASE
            WHEN SUM(m.CantFacturada * (${precioListaRealCASE})) > 0
            THEN ROUND(
              (1 - SUM(m.TotLinea)
                 / NULLIF(SUM(m.CantFacturada * (${precioListaRealCASE})), 0)
              ) * 100, 2)
            ELSE 0
          END                                                            AS pctDescuento
        FROM [PRODIN].[softland].[iw_gsaen] enc
        INNER JOIN [PRODIN].[softland].[iw_gmovi] m
          ON m.NroInt = enc.NroInt AND m.Tipo = enc.Tipo
        INNER JOIN [PRODIN].[softland].[iw_tprod] t ON t.CodProd = m.CodProd
        LEFT JOIN [PRODIN].[softland].[cwtcvcl] cvl ON cvl.CodAux = enc.CodAux
        WHERE enc.CodVendedor IN (${codigosIn})
          AND enc.Tipo IN ('F','N','D') AND enc.Estado <> 'A'
          AND MONTH(enc.Fecha) = @mes AND YEAR(enc.Fecha) = @anio
        GROUP BY enc.CodVendedor
        ORDER BY totalVentasCobrado DESC
      `);

    res.json({ ok: true, vendedores: result.recordset });
  } catch (err) {
    console.error('[GET /api/ventas/resumen-vendedores]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener resumen vendedores' });
  }
});

// GET /api/ventas/evolucion
router.get('/evolucion', requireAuth, async (req, res) => {
  try {
    let anio;
    try { ({ anio } = validarMesAnio(req.query.mes ?? '1', req.query.anio)); }
    catch (err) { return res.status(400).json({ ok: false, error: err.message }); }
    const codigos   = getCodigos(req);
    const usuarioId = req.usuario?.id;

    const [metaRows] = await db.query(
      `SELECT meta FROM vendedor_meta WHERE usuario_id = ? AND YEAR(fecha) = ? LIMIT 1`,
      [usuarioId, anio]
    );
    const metaAnual = metaRows.length ? Number(metaRows[0].meta) : 0;
    const metaMes   = metaAnual > 0 ? Math.round(metaAnual / 12) : 0;

    if (!codigos.length) {
      return res.json({ ok: true, evolucion: Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, ventas: 0, meta: metaMes })) });
    }

    const pool   = await getSoftlandPool();
    const result = await pool.request().input('anio', sql.Int, anio).query(`
      SELECT MONTH(enc.Fecha) AS mes, SUM(m.TotLinea) AS ventas
      FROM [PRODIN].[softland].[iw_gsaen] enc
      INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = enc.NroInt AND m.Tipo = enc.Tipo
      WHERE enc.CodVendedor IN (${codigos.map(c => `'${c}'`).join(',')})
        AND YEAR(enc.Fecha) = @anio AND enc.Tipo IN ('F','N','D') AND enc.Estado <> 'A'
      GROUP BY MONTH(enc.Fecha) ORDER BY mes
    `);

    const ventasPorMes = {};
    result.recordset.forEach(r => { ventasPorMes[r.mes] = Number(r.ventas) || 0; });
    const evolucion = Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, ventas: ventasPorMes[i + 1] || 0, meta: metaMes }));
    res.json({ ok: true, evolucion });
  } catch (err) {
    console.error('[GET /api/ventas/evolucion]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener evolución' });
  }
});

// GET /api/ventas/resumen
router.get('/resumen', requireAuth, async (req, res) => {
  try {
    const codigos = getCodigos(req);
    if (!codigos.length) return res.json({ ok: true, resumen: [] });
    let mes, anio;
    try { ({ mes, anio } = validarMesAnio(req.query.mes, req.query.anio)); }
    catch (err) { return res.status(400).json({ ok: false, error: err.message }); }
    const resumen = await getResumenPorVendedor({ codigos, mes, anio });
    res.json({ ok: true, resumen });
  } catch (err) {
    console.error('[GET /api/ventas/resumen]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener resumen por vendedor' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ventas/clientes   — autocomplete libre (q=texto)
// Admin / sin cartera: busca en todos los clientes (sin filtro de vendedor).
// Vendedor normal: restringe a su cartera.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/clientes', requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) return res.json({ ok: true, clientes: [] });

    const qSafe = q.replace(/[%_[\]]/g, c => `[${c}]`);
    const pool  = await getSoftlandPool();
    const req2  = pool.request()
      .input('q1', sql.NVarChar, `%${qSafe}%`)
      .input('q2', sql.NVarChar, `%${qSafe}%`);

    let whereVendedor = '';
    if (!isAdmin(req)) {
      const codigosIn = getCodigos(req).map(c => `'${c}'`).join(',');
      whereVendedor = `
        AND EXISTS (
          SELECT 1
          FROM [PRODIN].[softland].[iw_gsaen] h
          WHERE h.CodAux = c.CodAux
            AND h.CodVendedor IN (${codigosIn})
            AND h.Tipo IN ('F','N','D')
            AND h.Estado <> 'A'
        )`;
    }

    const result = await req2.query(`
      SELECT TOP 40
        c.CodAux,
        RTRIM(c.NomAux)   AS NomAux,
        RTRIM(c.FonAux1)  AS FonAux1,
        RTRIM(c.EMail)    AS Email
      FROM [PRODIN].[softland].[cwtauxi] c
      WHERE (
        RTRIM(c.NomAux) LIKE @q1
        OR c.CodAux     LIKE @q2
      )
      ${whereVendedor}
      ORDER BY RTRIM(c.NomAux)
    `);

    res.json({ ok: true, clientes: result.recordset });
  } catch (err) {
    console.error('[GET /api/ventas/clientes]', err.message);
    res.status(500).json({ ok: false, error: 'Error al buscar clientes' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ventas/cliente-info   — información completa del cliente
//   ?codAux=XXX
//   Devuelve: rut, nombre, telefono, direccion, comuna, email
// ─────────────────────────────────────────────────────────────────────────────
router.get('/cliente-info', requireAuth, async (req, res) => {
  try {
    const { codAux } = req.query;
    if (!codAux) return res.status(400).json({ ok: false, error: 'Parámetro codAux requerido' });

    const pool   = await getSoftlandPool();
    const result = await pool.request()
      .input('codAux', sql.VarChar(20), codAux)
      .query(`
        SELECT TOP 1
          RTRIM(c.CodAux)   AS rut,
          RTRIM(c.NomAux)   AS nombre,
          RTRIM(c.FonAux1)  AS telefono,
          RTRIM(c.DirAux)   AS direccion,
          RTRIM(c.Ciudad)   AS comuna,
          RTRIM(c.EMail)    AS email
        FROM [PRODIN].[softland].[cwtauxi] c
        WHERE c.CodAux = @codAux
      `);

    if (!result.recordset.length) {
      return res.status(404).json({ ok: false, error: 'Cliente no encontrado' });
    }

    res.json({ ok: true, cliente: result.recordset[0] });
  } catch (err) {
    console.error('[GET /api/ventas/cliente-info]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener información del cliente' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ventas/historial-cliente
//   ?codAux=XXX  &desde=YYYY-MM-DD  &hasta=YYYY-MM-DD
// Admin / sin cartera: devuelve toda la historia del cliente.
// Vendedor normal: restringe al CodVendedor de su cartera.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/historial-cliente', requireAuth, async (req, res) => {
  try {
    const { codAux, desde, hasta } = req.query;

    if (!codAux) return res.status(400).json({ ok: false, error: 'Parámetro codAux requerido' });
    if (!desde || !hasta) return res.status(400).json({ ok: false, error: 'Parámetros desde y hasta requeridos (YYYY-MM-DD)' });

    const reISO = /^\d{4}-\d{2}-\d{2}$/;
    if (!reISO.test(desde) || !reISO.test(hasta)) {
      return res.status(400).json({ ok: false, error: 'Fechas deben ser YYYY-MM-DD' });
    }
    if (desde > hasta) {
      return res.status(400).json({ ok: false, error: 'La fecha desde no puede ser mayor a hasta' });
    }

    // Filtro de vendedor: sólo se aplica para vendedores con cartera asignada.
    let whereVendedor = '';
    if (!isAdmin(req)) {
      const codigosIn = getCodigos(req).map(c => `'${c}'`).join(',');
      whereVendedor = `AND h.CodVendedor IN (${codigosIn})`;
    }

    const pool   = await getSoftlandPool();
    const result = await pool.request()
      .input('codAux', sql.VarChar(20), codAux)
      .input('desde',  sql.Date, desde)
      .input('hasta',  sql.Date, hasta)
      .query(`
        SELECT
          c.CodAux,
          RTRIM(c.NomAux)               AS NomAux,
          RTRIM(c.FonAux1)              AS FonAux1,
          RTRIM(c.EMail)                AS Email,
          h.CodVendedor,
          CONVERT(varchar(10), h.Fecha, 120) AS Fecha,
          m.CodProd,
          CAST(m.DetProd AS varchar(max)) AS DetProd,
          m.TotLinea,
          YEAR(h.Fecha)                 AS Anio,
          MONTH(h.Fecha)                AS Mes
        FROM [PRODIN].[softland].[iw_gsaen] h
        INNER JOIN [PRODIN].[softland].[cwtauxi] c
          ON c.CodAux = h.CodAux
        INNER JOIN [PRODIN].[softland].[iw_gmovi] m
          ON m.Tipo   = h.Tipo
         AND m.NroInt = h.NroInt
        WHERE h.Tipo IN ('F', 'N', 'D')
          AND h.Estado <> 'A'
          AND h.CodAux = @codAux
          ${whereVendedor}
          AND h.Fecha >= @desde
          AND h.Fecha <= @hasta
        ORDER BY c.CodAux, h.Fecha DESC, m.CodProd
      `);

    res.json({ ok: true, historial: result.recordset });
  } catch (err) {
    console.error('[GET /api/ventas/historial-cliente]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener historial del cliente' });
  }
});

// GET /api/ventas/folio/:folio
router.get('/folio/:folio', requireAuth, async (req, res) => {
  try {
    const folio = req.params.folio;
    let anio;
    try { ({ anio } = validarMesAnio('1', req.query.anio)); }
    catch (err) { return res.status(400).json({ ok: false, error: err.message }); }
    const data = await getMontoFolio({ folio, anio });
    if (!data) return res.status(404).json({ ok: false, error: 'Folio no encontrado' });
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error('[GET /api/ventas/folio]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener folio' });
  }
});

// GET /api/ventas/detalle/:folio
router.get('/detalle/:folio', requireAuth, async (req, res) => {
  try {
    const folio   = req.params.folio;
    const detalle = await getDetalleFolio({ folio });
    res.json({ ok: true, detalle });
  } catch (err) {
    console.error('[GET /api/ventas/detalle]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener detalle del folio' });
  }
});

// GET /api/ventas/descuentos
router.get('/descuentos', requireAuth, async (req, res) => {
  try {
    let mes, anio;
    try { ({ mes, anio } = validarMesAnio(req.query.mes, req.query.anio)); }
    catch (err) { return res.status(400).json({ ok: false, error: err.message }); }
    const codigos = getCodigos(req);
    const data    = await getDescuentosVendedor({ codigos, mes, anio });
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[GET /api/ventas/descuentos]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
