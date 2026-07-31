'use strict';

/**
 * routes/ventas.js — API REST módulo de ventas
 *
 * GET  /api/ventas                      — lista de folios del mes
 * GET  /api/ventas/kpis                 — KPIs card
 * GET  /api/ventas/total                — total ventas del mes
 * GET  /api/ventas/resumen              — resumen por vendedor
 * GET  /api/ventas/resumen-vendedores   — ventas agrupadas por cod_vendedor
 * GET  /api/ventas/evolucion            — ventas mes a mes del año
 * GET  /api/ventas/meta                 — meta anual/mensual
 * GET  /api/ventas/clientes             — autocomplete de clientes (q=texto)
 * GET  /api/ventas/cliente-info         — info completa del cliente: ?codAux=
 * GET  /api/ventas/historial-cliente    — historial por cliente
 * GET  /api/ventas/folio/:folio         — monto de un folio
 * GET  /api/ventas/detalle/:folio       — detalle líneas de un folio
 * GET  /api/ventas/descuentos           — descuentos por vendedor
 * POST /api/ventas/confirmar            — confirma ventas del mes → genera PDF
 * GET  /api/ventas/confirmacion-estado  — estado de confirmación del mes actual
 * GET  /api/ventas/confirmacion/:id/pdf — descarga el PDF propio del vendedor
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
  getVentas,
  getMontoFolio,
  getDetalleFolio,
  getDescuentosVendedor,
} = require('../models/venta');
const { validarMesAnio } = require('../utils/stringHelpers');
const { obtenerMetaVendedor } = require('../models/vendedorMeta');
const {
  existeConfirmacion,
  crearConfirmacion,
  obtenerConfirmacionPorId,
  obtenerConfirmacionUsuario,
} = require('../models/confirmacion');
const {
  guardarReporteCompartidoConfirmado,
  obtenerReporteCompartidoUsuarioPeriodo,
} = require('../models/reporteCompartido');
const { generarPdfConfirmacion } = require('../utils/pdfConfirmacion');
const {
  crearNotificacion,
  obtenerUsuariosRrhhYAdmin,
} = require('../models/notificacion');
const socketHub = require('../realtime/socketHub');

/** Códigos de vendedor asignados al usuario autenticado. */
function getCodigos(req) {
  return (req.usuario?.vendedores ?? []).map(v => v.cod_vendedor).filter(Boolean);
}

function getUsuarioId(req) {
  return req.usuario?.id ?? req.usuario?.sub;
}

function buildInParams(request, valores, prefijo = 'cod') {
  return valores.map((valor, index) => {
    const name = `${prefijo}${index}`;
    request.input(name, sql.VarChar(20), String(valor));
    return `@${name}`;
  }).join(',');
}

function buildCarteraExistsClause(codigosIn, aliasCliente = 'c') {
  return `
    EXISTS (
      SELECT 1
      FROM [PRODIN].[softland].[cwtauxven] av
      WHERE av.CodAux = ${aliasCliente}.CodAux
        AND av.VenCod IN (${codigosIn})
    )
  `;
}

async function cargarFoliosAsignadosConfirmables({ usuarioId, codigos, mes, anio }) {
  if (!codigos.length) return [];
  const placeholders = codigos.map(() => '?').join(',');
  const params = [...codigos];
  let wherePeriodo = '';
  if (Number.isInteger(Number(mes)) && Number.isInteger(Number(anio))) {
    wherePeriodo = ' AND fc.mes = ? AND fc.anio = ?';
    params.push(Number(mes), Number(anio));
  }

  const [rows] = await db.query(
    `SELECT
       fc.id,
       fc.folio,
       fc.fecha,
       fc.cliente,
       fc.monto_neto,
       fc.monto_asignado,
       fc.porcentaje,
       fc.cod_vendedor_principal,
       fc.cod_vendedor_compartido,
       fc.nombre_vendedor_compartido,
       fc.mes,
       fc.anio,
       fc.rol
     FROM factura_compartida fc
     WHERE fc.cod_vendedor_principal IN (${placeholders})
       AND fc.rol = 'compartido'
       ${wherePeriodo}
     ORDER BY fc.fecha DESC, fc.folio DESC`,
    params
  );
  return rows.map(row => ({
    ...row,
    usuario_id: usuarioId,
  }));
}

function buildReporteCompartidoSnapshot({ usuario, mes, anio, rows }) {
  const filas = Array.isArray(rows) ? rows : [];
  const periodoLabel = new Date(Number(anio), Number(mes) - 1, 1).toLocaleDateString('es-CL', {
    month: 'long',
    year: 'numeric',
  });

  const foliosAsignados = filas.map(row => ({
    folio: String(row.folio || ''),
    fecha: row.fecha ? new Date(row.fecha).toLocaleDateString('es-CL') : '',
    cliente: row.cliente || '',
    vendedor_asignado: row.nombre_vendedor_compartido || row.cod_vendedor_compartido || '',
    porcentaje_participacion: Number(row.porcentaje || 0),
    monto_asignado: Number(row.monto_asignado || 0),
  }));

  const totalMontoAsignado = foliosAsignados.reduce((acc, row) => acc + Number(row.monto_asignado || 0), 0);

  return {
    tipo: 'folios_asignados',
    resumen: {
      cantidad_folios: new Set(foliosAsignados.map(row => String(row.folio))).size,
      cantidad_lineas: foliosAsignados.length,
      total_monto_asignado: Math.round(totalMontoAsignado),
      total_venta: Math.round(totalMontoAsignado),
      total_venta_real: Math.round(totalMontoAsignado),
      total_descuento: 0,
      total_comision: Math.round(totalMontoAsignado),
    },
    folios_asignados: foliosAsignados,
    periodo: { anio: Number(anio), mes: Number(mes), label: periodoLabel },
    generado_en: new Date().toISOString(),
    confirmacion: {
      confirmado_por: Number(usuario?.id ?? usuario?.sub),
      confirmado_at: new Date().toISOString(),
    },
    usuario: {
      id: Number(usuario?.id ?? usuario?.sub),
      nombre: usuario?.nombre || '',
      email: usuario?.email || '',
      area: usuario?.area || '',
    },
  };
}

async function notificarReporteCompartidoRRHH({ usuario, reporteId, snapshot }) {
  const destinatarios = Array.from(new Set(await obtenerUsuariosRrhhYAdmin()));
  if (!destinatarios.length) return { creadas: 0, emitidas: 0, destinatarios: [] };

  const periodoLabel = snapshot?.periodo?.label || new Date(
    Number(snapshot?.periodo?.anio || snapshot?.anio || 0),
    Number(snapshot?.periodo?.mes || snapshot?.mes || 1) - 1,
    1
  ).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });

  const titulo = 'Nuevo reporte de ventas compartidas';
  const mensaje = `${usuario?.nombre || 'Un vendedor'} envió su reporte de ventas compartidas de ${periodoLabel} para revisión de RRHH.`;
  const notificacionBase = {
    tipo: 'reporte_compartido_enviado',
    titulo,
    mensaje,
    folio: String(reporteId || ''),
    mes: snapshot?.periodo?.mes ?? snapshot?.mes ?? null,
    anio: snapshot?.periodo?.anio ?? snapshot?.anio ?? null,
  };

  let creadas = 0;
  let emitidas = 0;

  for (const usuarioId of destinatarios) {
    try {
      await crearNotificacion({ usuarioId, ...notificacionBase });
      creadas += 1;
    } catch (err) {
      console.warn('[ventas compartidas] No se pudo registrar la notificación RRHH:', err.message);
      continue;
    }

    try {
      socketHub.emitToUser(usuarioId, 'notificacion:new', {
        notificacion: {
          id: null,
          usuario_id: usuarioId,
          ...notificacionBase,
          leida: 0,
          fecha_creacion: new Date().toISOString(),
        },
      });
      emitidas += 1;
    } catch (err) {
      console.warn('[ventas compartidas] No se pudo emitir la notificación RRHH:', err.message);
    }
  }

  return { creadas, emitidas, destinatarios };
}

function construirEstadoReporteCompartido(reporte) {
  if (!reporte) {
    return {
      existe: false,
      confirmado: false,
      estado: null,
      confirmado_at: null,
      revisado_at: null,
      motivo_rechazo: null,
      comentario_rrhh: null,
      reporte: null,
    };
  }

  return {
    existe: true,
    confirmado: true,
    estado: reporte.estado || null,
    confirmado_at: reporte.confirmado_at || null,
    revisado_at: reporte.revisado_at || null,
    motivo_rechazo: reporte.motivo_rechazo || null,
    comentario_rrhh: reporte.comentario_rrhh || null,
    reporte: {
      id: reporte.id,
      estado: reporte.estado,
      confirmado_at: reporte.confirmado_at,
      revisado_at: reporte.revisado_at,
      motivo_rechazo: reporte.motivo_rechazo || null,
      comentario_rrhh: reporte.comentario_rrhh || null,
      periodo_label: reporte.periodo_label,
    },
  };
}

async function generarSnapshotYGuardarReporteCompartido({ usuario, usuarioId, mes, anio, codigos }) {
  const reporteExistente = await obtenerReporteCompartidoUsuarioPeriodo(usuarioId, anio, mes);
  if (reporteExistente && ['confirmado_vendedor', 'validado_rrhh'].includes(String(reporteExistente.estado || ''))) {
    const error = new Error(
      reporteExistente.estado === 'validado_rrhh'
        ? 'Este reporte ya fue validado por RRHH.'
        : 'Este reporte ya fue confirmado y enviado a RRHH.'
    );
    error.code = reporteExistente.estado === 'validado_rrhh' ? 'REPORTE_YA_VALIDADO' : 'REPORTE_YA_CONFIRMADO';
    throw error;
  }

  const detalles = await cargarFoliosAsignadosConfirmables({
    usuarioId,
    codigos,
    mes,
    anio,
  });

  if (!detalles.length) {
    const error = new Error('No hay folios asignados para confirmar en este período.');
    error.code = 'REPORTE_SIN_DATOS';
    throw error;
  }
  const snapshot = buildReporteCompartidoSnapshot({ usuario, mes, anio, rows: detalles });


  const guardado = await guardarReporteCompartidoConfirmado({
    vendedorUsuarioId: usuarioId,
    vendedorNombre: usuario?.nombre || 'Sin nombre',
    vendedorEmail: usuario?.email || null,
    anio,
    mes,
    totalVenta: snapshot.resumen.total_venta,
    totalVentaReal: snapshot.resumen.total_venta_real,
    totalDescuento: snapshot.resumen.total_descuento,
    totalComision: snapshot.resumen.total_comision,
    cantidadFolios: snapshot.resumen.cantidad_folios,
    cantidadLineas: snapshot.resumen.cantidad_lineas,
    reporteJson: snapshot,
    confirmadoPor: usuarioId,
  });

  return { id: guardado?.id || guardado || 0, snapshot };
}

// ────────────────────────────────────────────────────────────────────────────
// Rutas existentes (sin cambios)
// ────────────────────────────────────────────────────────────────────────────

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

    const usuarioId = getUsuarioId(req);
    const metaInfo = await obtenerMetaVendedor(db, usuarioId, anio, mes);
    const metaMes = Number(metaInfo.meta_mes || 0);

    if (!codigos.length) return res.json({ ok: true, totalVentas: 0, metaMes, totalDescuento: 0 });

    const precioListaRealCASE = await buildPrecioListaRealCASE(db, {
      campoFecha: 'enc.Fecha', campoCodProd: 'm.CodProd',
      campoTotLinea: 'm.TotLinea', campoCant: 'm.CantFacturada',
      campoPrecioVta: 't.PrecioVta', campoCodCan: 'cvl.CodCan',
    });

    const pool   = await getSoftlandPool();
    const request = pool.request()
      .input('mes', sql.Int, mes).input('anio', sql.Int, anio);
    const codigosIn = buildInParams(request, codigos);
    const result = await request
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
    const usuarioId = getUsuarioId(req);
    const metaInfo = await obtenerMetaVendedor(db, usuarioId, anio, 1);
    res.json({
      ok: true,
      metaAnual: Number(metaInfo.meta_original || 0),
      metaMes: Number(metaInfo.meta_mes || 0),
      tipo_periodo: metaInfo.tipo_periodo,
      fecha: metaInfo.fecha,
      prorrateada: Boolean(metaInfo.prorrateada),
    });
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

    const precioListaRealCASE = await buildPrecioListaRealCASE(db, {
      campoFecha: 'enc.Fecha', campoCodProd: 'm.CodProd',
      campoTotLinea: 'm.TotLinea', campoCant: 'm.CantFacturada',
      campoPrecioVta: 't.PrecioVta', campoCodCan: 'cvl.CodCan',
    });

    const pool   = await getSoftlandPool();
    const request = pool.request()
      .input('mes', sql.Int, mes).input('anio', sql.Int, anio);
    const codigosIn = buildInParams(request, codigos);
    const result = await request
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
    const usuarioId = getUsuarioId(req);
    const metaInfo = await obtenerMetaVendedor(db, usuarioId, anio, 1);
    const metaMes = Number(metaInfo.meta_mes || 0);

    if (!codigos.length) {
      return res.json({ ok: true, evolucion: Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, ventas: 0, meta: metaMes })) });
    }

    const pool = await getSoftlandPool();
    const request = pool.request().input('anio', sql.Int, anio);
    const codigosIn = buildInParams(request, codigos);
    const result = await request.query(`
      SELECT MONTH(enc.Fecha) AS mes, SUM(m.TotLinea) AS ventas
      FROM [PRODIN].[softland].[iw_gsaen] enc
      INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = enc.NroInt AND m.Tipo = enc.Tipo
      WHERE enc.CodVendedor IN (${codigosIn})
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

// GET /api/ventas/clientes
router.get('/clientes', requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) return res.json({ ok: true, clientes: [] });
    const codigos = getCodigos(req);
    if (!codigos.length) return res.json({ ok: true, clientes: [] });

    const qSafe = q.replace(/[%_[\]]/g, c => `[${c}]`);
    const pool = await getSoftlandPool();
    const request = pool.request()
      .input('q1', sql.NVarChar, `%${qSafe}%`)
      .input('q2', sql.NVarChar, `%${qSafe}%`);
    const codigosIn = buildInParams(request, codigos);

    const result = await request.query(`
        SELECT TOP 40
          c.CodAux,
          RTRIM(c.NomAux)   AS NomAux,
          RTRIM(c.FonAux1)  AS FonAux1,
          RTRIM(c.FonAux2)  AS FonAux2,
          RTRIM(c.EMail)    AS Email
        FROM [PRODIN].[softland].[cwtauxi] c
        WHERE (
          RTRIM(c.NomAux) LIKE @q1
          OR c.CodAux     LIKE @q2
        )
        AND ${buildCarteraExistsClause(codigosIn)}
        ORDER BY RTRIM(c.NomAux)
      `);
    res.json({ ok: true, clientes: result.recordset });
  } catch (err) {
    console.error('[GET /api/ventas/clientes]', err.message);
    res.status(500).json({ ok: false, error: 'Error al buscar clientes' });
  }
});

// GET /api/ventas/cliente-info
router.get('/cliente-info', requireAuth, async (req, res) => {
  try {
    const { codAux } = req.query;
    if (!codAux) return res.status(400).json({ ok: false, error: 'Parámetro codAux requerido' });
    const codigos = getCodigos(req);
    if (!codigos.length) return res.status(403).json({ ok: false, error: 'Sin permiso para este cliente' });

    const pool   = await getSoftlandPool();
    const request = pool.request()
      .input('codAux', sql.VarChar(20), codAux);
    const codigosIn = buildInParams(request, codigos);
    const result = await request
      .query(`
        SELECT TOP 1
          RTRIM(c.CodAux)           AS rut,
          RTRIM(c.NomAux)           AS nombre,
          RTRIM(c.FonAux1)          AS telefono,
          RTRIM(c.FonAux2)          AS telefono2,
          RTRIM(c.DirAux)           AS direccion,
          RTRIM(ciud.CiuDes)        AS ciudad,
          RTRIM(c.EMail)            AS email
        FROM [PRODIN].[softland].[cwtauxi] c
        LEFT JOIN [PRODIN].[softland].[cwtciud] ciud
          ON RTRIM(c.CiuAux) = RTRIM(ciud.CiuCod)
        WHERE c.CodAux = @codAux
          AND ${buildCarteraExistsClause(codigosIn)}
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

// GET /api/ventas/historial-cliente
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
    const codigos = getCodigos(req);
    if (!codigos.length) return res.json({ ok: true, historial: [] });

    const pool = await getSoftlandPool();
    const request = pool.request()
      .input('codAux', sql.VarChar(20), codAux)
      .input('desde',  sql.Date, desde)
      .input('hasta',  sql.Date, hasta);
    const codigosIn = buildInParams(request, codigos);

    const result = await request.query(`
      SELECT
        c.CodAux,
        RTRIM(c.NomAux)                    AS NomAux,
        RTRIM(c.FonAux1)                   AS FonAux1,
        RTRIM(c.FonAux2)                   AS FonAux2,
        RTRIM(c.EMail)                     AS Email,
        RTRIM(c.DirAux)                    AS Direccion,
        RTRIM(ciud.CiuDes)                 AS Ciudad,
        h.CodVendedor,
        CONVERT(varchar(10), h.Fecha, 120) AS Fecha,
        m.CodProd,
        CAST(m.DetProd AS varchar(max))    AS DetProd,
        m.TotLinea,
        YEAR(h.Fecha)                      AS Anio,
        MONTH(h.Fecha)                     AS Mes
      FROM [PRODIN].[softland].[iw_gsaen] h
      INNER JOIN [PRODIN].[softland].[cwtauxi] c
        ON c.CodAux = h.CodAux
      LEFT JOIN [PRODIN].[softland].[cwtciud] ciud
        ON RTRIM(c.CiuAux) = RTRIM(ciud.CiuCod)
      INNER JOIN [PRODIN].[softland].[iw_gmovi] m
        ON m.Tipo   = h.Tipo
       AND m.NroInt = h.NroInt
      WHERE h.Tipo IN ('F', 'N', 'D')
        AND h.Estado <> 'A'
        AND h.CodAux = @codAux
        AND ${buildCarteraExistsClause(codigosIn, 'h')}
        AND h.Fecha >= @desde
        AND h.Fecha <= @hasta
      ORDER BY h.Fecha DESC, m.CodProd
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
    const anio    = req.query.anio;
    const detalle = await getDetalleFolio({ folio, anio });
    const primera = Array.isArray(detalle) ? detalle[0] || {} : {};
    const tipoFolio = String(primera.tipo_folio ?? primera.Tipo ?? primera.tipo ?? '').trim().toUpperCase();
    res.json({
      ok: true,
      detalle,
      tipo_folio: ['F', 'N', 'D'].includes(tipoFolio) ? tipoFolio : '',
      Tipo: ['F', 'N', 'D'].includes(tipoFolio) ? tipoFolio : '',
      tipo: ['F', 'N', 'D'].includes(tipoFolio) ? tipoFolio : '',
    });
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

// ────────────────────────────────────────────────────────────────────────────
// NUEVAS RUTAS — Confirmación de ventas
// ────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/ventas/confirmacion-estado
 * Retorna si el usuario ya confirmó el mes/año solicitado.
 * ?mes=6&anio=2026
 */
router.get('/confirmacion-estado', requireAuth, async (req, res) => {
  try {
    let mes, anio;
    try { ({ mes, anio } = validarMesAnio(req.query.mes, req.query.anio)); }
    catch (err) { return res.status(400).json({ ok: false, error: err.message }); }

    const usuarioId = getUsuarioId(req);
    const conf = await obtenerConfirmacionUsuario({ usuarioId, mes, anio });

    res.json({
      ok: true,
      confirmado: !!conf,
      confirmacion: conf ? {
        id:                 conf.id,
        fecha_confirmacion: conf.fecha_confirmacion,
        total_folios:       conf.total_folios,
        nombre_archivo:     conf.nombre_archivo,
      } : null,
    });
  } catch (err) {
    console.error('[GET /api/ventas/confirmacion-estado]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener estado de confirmación' });
  }
});

/**
 * GET /api/ventas/compartidas/confirmacion
 * Estado de la confirmación del reporte de ventas compartidas.
 */
async function obtenerEstadoReporteCompartidoHandler(req, res) {
  try {
    let mes, anio;
    try { ({ mes, anio } = validarMesAnio(req.query.mes, req.query.anio)); }
    catch (err) { return res.status(400).json({ ok: false, error: err.message }); }

    const usuarioId = getUsuarioId(req);
    const reporte = await obtenerReporteCompartidoUsuarioPeriodo(usuarioId, anio, mes);
    res.json({
      ok: true,
      ...construirEstadoReporteCompartido(reporte),
    });
  } catch (err) {
    console.error('[GET /api/ventas/compartidas/confirmacion]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener estado de confirmación compartida' });
  }
}

router.get('/compartidas/confirmacion', requireAuth, obtenerEstadoReporteCompartidoHandler);
router.get('/compartidas/confirmacion-estado', requireAuth, obtenerEstadoReporteCompartidoHandler);

/**
 * POST /api/ventas/confirmar
 * Confirma todas las ventas del mes para el usuario autenticado.
 * Body: { mes: number, anio: number }
 *
 * Flujo:
 *  1. Valida que no exista confirmación previa (409 si ya existe)
 *  2. Consulta ventas propias desde Softland
 *  3. Consulta ventas asignadas desde factura_compartida (MySQL)
 *  4. Consulta meta mensual
 *  5. Genera PDF con Puppeteer
 *  6. Inserta registro en confirmaciones_ventas
 *  7. Retorna { ok, id, nombreArchivo }
 */
router.post('/confirmar', requireAuth, async (req, res) => {
  try {
    let mes, anio;
    try { ({ mes, anio } = validarMesAnio(req.body.mes, req.body.anio)); }
    catch (err) { return res.status(400).json({ ok: false, error: err.message }); }

    const usuarioId = getUsuarioId(req);
    const usuario   = req.usuario; // { id, nombre, apellido, email, vendedores, is_admin }

    // 1. Verificar confirmación previa
    const yaConfirmado = await existeConfirmacion({ usuarioId, mes, anio });
    if (yaConfirmado) {
      return res.status(409).json({
        ok:    false,
        error: `Ya confirmaste el período ${mes}/${anio}. Solo se permite una confirmación por mes.`,
      });
    }

    const codigos = getCodigos(req);

    // 2. Ventas propias desde Softland
    let ventasPropias = [];
    let totalPropias  = 0;

    if (codigos.length > 0) {
      const pool = await getSoftlandPool();
      const request = pool.request()
        .input('mes', sql.Int, mes)
        .input('anio', sql.Int, anio);
      const codigosIn = buildInParams(request, codigos);
      const result = await request
        .query(`
          SELECT
            enc.Folio,
            RTRIM(enc.NomAux)                    AS NomAux,
            CONVERT(varchar(10), enc.Fecha, 120) AS Fecha,
            enc.CodVendedor,
            SUM(m.TotLinea)                      AS TotLinea,
            CASE
              WHEN SUM(m.TotLinea) > 0 AND SUM(m.TotLinea) < SUM(m.CantFacturada * t.PrecioVta)
              THEN ROUND((1 - SUM(m.TotLinea) / NULLIF(SUM(m.CantFacturada * t.PrecioVta),0))*100, 2)
              ELSE 0
            END AS pctDescuento
          FROM [PRODIN].[softland].[iw_gsaen] enc
          INNER JOIN [PRODIN].[softland].[iw_gmovi] m
            ON m.NroInt = enc.NroInt AND m.Tipo = enc.Tipo
          INNER JOIN [PRODIN].[softland].[iw_tprod] t ON t.CodProd = m.CodProd
          WHERE enc.Tipo IN ('F','N','D') AND enc.Estado <> 'A'
            AND enc.CodVendedor IN (${codigosIn})
            AND MONTH(enc.Fecha) = @mes AND YEAR(enc.Fecha) = @anio
          GROUP BY enc.Folio, enc.NomAux, enc.Fecha, enc.CodVendedor
          ORDER BY enc.Fecha
        `);
      ventasPropias = result.recordset;
      totalPropias  = ventasPropias.reduce((a, v) => a + Number(v.TotLinea || 0), 0);
    }

    // 3. Ventas asignadas (factura_compartida en MySQL)
    const [fcRows] = await db.query(
      `SELECT folio, cliente, fecha, monto_asignado, porcentaje, rol,
              cod_vendedor_principal, cod_vendedor_compartido, nombre_vendedor_compartido
       FROM factura_compartida
       WHERE usuario_id = ? AND mes = ? AND anio = ?
       ORDER BY fecha`,
      [usuarioId, mes, anio]
    );
    const ventasAsignadas  = fcRows;
    const totalAsignadas   = fcRows.reduce((a, f) => a + Number(f.monto_asignado || 0), 0);

    // 4. Meta mensual
    const [metaRows] = await db.query(
      `SELECT meta FROM vendedor_meta WHERE usuario_id = ? AND YEAR(fecha) = ? LIMIT 1`,
      [usuarioId, anio]
    );
    const metaAnual = metaRows.length ? Number(metaRows[0].meta) : 0;
    const meta      = metaAnual > 0 ? metaAnual : 0;

    // 5. Generar PDF
    const { rutaPdf, nombreArchivo } = await generarPdfConfirmacion({
      usuario:         { id: usuarioId, nombre: usuario.nombre, apellido: usuario.apellido, email: usuario.email },
      mes,
      anio,
      ventasPropias,
      ventasAsignadas,
      meta,
      totalPropias:    Math.round(totalPropias),
      totalAsignadas:  Math.round(totalAsignadas),
    });

    // 6. Insertar en BD
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    const id = await crearConfirmacion({
      usuarioId,
      mes,
      anio,
      rutaPdf,
      nombreArchivo,
      totalVentasPropias:      Math.round(totalPropias),
      totalVentasAsignadas:    Math.round(totalAsignadas),
      totalFolios:             ventasPropias.length,
      totalFacturasCompartidas: ventasAsignadas.length,
      ip,
    });

    res.json({
      ok:           true,
      id,
      nombreArchivo,
      totalPropias:  Math.round(totalPropias),
      totalAsignadas: Math.round(totalAsignadas),
      totalFolios:   ventasPropias.length,
    });
  } catch (err) {
    console.error('[POST /api/ventas/confirmar]', err.message);
    res.status(500).json({ ok: false, error: 'Error al generar la confirmación' });
  }
});

/**
 * POST /api/ventas/compartidas/confirmar
 * Confirma el snapshot del reporte de ventas compartidas del período.
 */
async function confirmarReporteCompartidoHandler(req, res) {
  try {
    let mes, anio;
    try { ({ mes, anio } = validarMesAnio(req.body.mes, req.body.anio)); }
    catch (err) { return res.status(400).json({ ok: false, error: err.message }); }

    const usuario = req.usuario;
    const usuarioId = getUsuarioId(req);
    const codigos = getCodigos(req);

    if (!codigos.length) {
      return res.status(403).json({ ok: false, error: 'No tienes códigos de vendedor para confirmar este reporte.' });
    }

    const { id, snapshot } = await generarSnapshotYGuardarReporteCompartido({
      usuario,
      usuarioId,
      mes,
      anio,
      codigos,
    });

    try {
      await notificarReporteCompartidoRRHH({ usuario, reporteId: id, snapshot });
    } catch (err) {
      console.warn('[POST /api/ventas/compartidas/confirmar] notificación RRHH:', err.message);
    }

    res.json({
      ok: true,
      id,
      estado: 'confirmado_vendedor',
      mensaje: 'Ventas compartidas confirmadas y enviadas a RRHH.',
      resumen: snapshot.resumen,
      periodo: snapshot.periodo,
    });
  } catch (err) {
    const codigo = String(err.code || '');
    if (codigo === 'REPORTE_SIN_DATOS') {
      return res.status(404).json({ ok: false, code: codigo, error: err.message });
    }
    if (codigo === 'REPORTE_YA_CONFIRMADO' || codigo === 'REPORTE_YA_VALIDADO') {
      return res.status(409).json({ ok: false, code: codigo, error: err.message });
    }
    console.error('[POST /api/ventas/compartidas/confirmar]', err.message);
    res.status(500).json({ ok: false, error: 'Error al confirmar el reporte de ventas compartidas' });
  }
}

router.post('/compartidas/confirmar', requireAuth, confirmarReporteCompartidoHandler);
router.post('/compartidas/confirmar-reporte', requireAuth, confirmarReporteCompartidoHandler);

/**
 * GET /api/ventas/confirmacion/:id/pdf
 * El vendedor descarga su propio PDF (solo puede ver el suyo).
 */
router.get('/confirmacion/:id/pdf', requireAuth, async (req, res) => {
  try {
    const fs   = require('fs');
    const path = require('path');
    const id   = Number(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ ok: false, error: 'ID inválido' });

    const conf = await obtenerConfirmacionPorId(id);
    if (!conf) return res.status(404).json({ ok: false, error: 'Confirmación no encontrada' });

    // Solo el propio usuario puede descargar su PDF (o admin)
    if (!req.usuario.is_admin && Number(conf.usuario_id) !== Number(getUsuarioId(req))) {
      return res.status(403).json({ ok: false, error: 'Sin permiso para este archivo' });
    }

    const rutaAbsoluta = path.join(process.cwd(), conf.ruta_pdf);
    if (!fs.existsSync(rutaAbsoluta)) {
      return res.status(404).json({ ok: false, error: 'Archivo no encontrado' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${conf.nombre_archivo}"`);
    fs.createReadStream(rutaAbsoluta).pipe(res);
  } catch (err) {
    console.error('[GET /api/ventas/confirmacion/:id/pdf]', err.message);
    res.status(500).json({ ok: false, error: 'Error al servir el PDF' });
  }
});

module.exports = router;


