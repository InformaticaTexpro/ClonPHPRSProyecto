'use strict';
/**
 * routes/rrhh.js - Submodulo RRHH
 *
 * Mantiene las confirmaciones historicas y expone la revision consolidada de
 * ventas compartidas para validacion de RRHH.
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const { requireAuth, requireRrhhOrAdmin } = require('../middlewares/requireAuth');
const { validateId, validateMesAnio } = require('../utils/validators');
const {
  listarConfirmaciones,
  obtenerConfirmacionPorId,
} = require('../models/confirmacion');
const {
  listarReportesCompartidos,
  obtenerReporteCompartidoPorId,
  actualizarEstadoReporteCompartido,
  obtenerRevisionVentasCompartidas,
} = require('../models/reporteCompartido');
const { CODIGOS_VENDEDORES_COMPARTIDOS } = require('../config/ventasCompartidas');
const {
  crearNotificacion,
} = require('../models/notificacion');
const socketHub = require('../realtime/socketHub');

router.use(requireAuth, requireRrhhOrAdmin);

function safeJoinFromProject(relativePath) {
  const projectRoot = process.cwd();
  const target = path.resolve(projectRoot, String(relativePath || ''));
  if (!target.startsWith(projectRoot + path.sep)) {
    throw new Error('Ruta de archivo invalida');
  }
  return target;
}

function parsePositiveInteger(value, label, { min = 0, max = 999999 } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} invalido: "${value}"`);
  }
  return parsed;
}

function parseBoolean(value) {
  return ['1', 'true', 'si', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

async function notificarUsuario({ usuarioId, tipo, titulo, mensaje, mes = null, anio = null, folio = null }) {
  if (!usuarioId) return false;

  try {
    await crearNotificacion({ usuarioId, tipo, titulo, mensaje, mes, anio, folio });
  } catch (err) {
    console.warn('[RRHH] No se pudo registrar la notificacion:', err.message);
    return false;
  }

  try {
    socketHub.emitToUser(usuarioId, 'notificacion:new', {
      notificacion: {
        id: null,
        usuario_id: usuarioId,
        tipo,
        titulo,
        mensaje,
        mes,
        anio,
        folio,
        leida: 0,
        fecha_creacion: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.warn('[RRHH] No se pudo emitir la notificacion en vivo:', err.message);
  }

  return true;
}

function extractFoliosSnapshot(reporteJson) {
  const folios = Array.isArray(reporteJson?.folios_asignados)
    ? reporteJson.folios_asignados
    : Array.isArray(reporteJson?.detalle)
      ? reporteJson.detalle
      : [];

  return folios
    .map(item => ({
      folio: String(item?.folio || '').trim(),
      fecha: item?.fecha || null,
      cliente: String(item?.cliente || '').trim(),
      vendedor_asignado: String(item?.vendedor_asignado || item?.nombre_vendedor_compartido || item?.cod_vendedor_compartido || '').trim(),
      vendedor_asignador: String(item?.vendedor_asignador || item?.vendedor_origen || item?.cod_vendedor_principal || '').trim(),
      porcentaje_participacion: Number(item?.porcentaje_participacion ?? item?.porcentaje ?? 0) || 0,
      monto_asignado: Number(item?.monto_asignado ?? item?.monto ?? 0) || 0,
    }))
    .filter(item => item.folio);
}

async function parseReportesFromRequest(req) {
  const filtros = {
    anio: undefined,
    mes: undefined,
    estado: undefined,
    vendedorUsuarioId: undefined,
    vendedorNombre: undefined,
    folio: undefined,
  };

  if (req.query.anio != null) {
    filtros.anio = parsePositiveInteger(req.query.anio, 'Año', { min: 2026, max: 2100 });
  }
  if (req.query.mes != null) {
    filtros.mes = parsePositiveInteger(req.query.mes, 'Mes', { min: 1, max: 12 });
  }
  if (req.query.estado) filtros.estado = String(req.query.estado).trim();
  if (req.query.vendedor_usuario_id != null) filtros.vendedorUsuarioId = parsePositiveInteger(req.query.vendedor_usuario_id, 'Vendedor');
  if (req.query.vendedor_nombre) filtros.vendedorNombre = String(req.query.vendedor_nombre).trim();
  if (req.query.folio) filtros.folio = String(req.query.folio).trim();

  const reportes = await listarReportesCompartidos(filtros);
  return reportes.map(reporte => ({
    id: reporte.id,
    vendedor_usuario_id: reporte.vendedor_usuario_id,
    vendedor_nombre: reporte.vendedor_nombre,
    vendedor_email: reporte.vendedor_email,
    anio: reporte.anio,
    mes: reporte.mes,
    periodo_label: reporte.periodo_label,
    cantidad_folios: reporte.cantidad_folios,
    total_venta: reporte.total_venta,
    total_venta_real: reporte.total_venta_real,
    total_descuento: reporte.total_descuento,
    total_comision: reporte.total_comision,
    estado: reporte.estado,
    confirmado_at: reporte.confirmado_at,
    revisado_at: reporte.revisado_at,
    comentario_rrhh: reporte.comentario_rrhh,
    motivo_rechazo: reporte.motivo_rechazo,
    reporte_json: reporte.reporte_json,
    folios_asignados: reporte.folios_asignados,
    tiene_diferencias: Boolean(reporte.tiene_diferencias),
    confirmado_por_nombre: reporte.confirmado_por_nombre || null,
    revisado_por_nombre: reporte.revisado_por_nombre || null,
    rechazado_por_nombre: reporte.rechazado_por_nombre || null,
  }));
}

// GET /api/rrhh/confirmaciones
router.get('/confirmaciones', async (req, res) => {
  try {
    let mes;
    let anio;

    if (req.query.mes != null || req.query.anio != null) {
      ({ mes, anio } = validateMesAnio(req.query.mes, req.query.anio));
    }

    const confirmaciones = await listarConfirmaciones({ mes, anio });
    res.json({ ok: true, confirmaciones });
  } catch (err) {
    const status = /invalid|inval/i.test(String(err.message || '')) ? 400 : 500;
    console.error('[GET /api/rrhh/confirmaciones]', err.message);
    res.status(status).json({ ok: false, error: status === 400 ? err.message : 'Error al obtener confirmaciones' });
  }
});

// GET /api/rrhh/confirmaciones/:id/pdf
router.get('/confirmaciones/:id/pdf', async (req, res) => {
  try {
    const id = validateId(req.params.id);
    const conf = await obtenerConfirmacionPorId(id);
    if (!conf) return res.status(404).json({ ok: false, error: 'Confirmacion no encontrada' });

    const rutaAbsoluta = safeJoinFromProject(conf.ruta_pdf);
    if (!fs.existsSync(rutaAbsoluta)) {
      return res.status(404).json({ ok: false, error: 'Archivo PDF no encontrado en disco' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${path.basename(conf.nombre_archivo || 'confirmacion.pdf')}"`
    );
    fs.createReadStream(rutaAbsoluta).pipe(res);
  } catch (err) {
    const status = /invalid|inval/i.test(String(err.message || '')) ? 400 : 500;
    console.error('[GET /api/rrhh/confirmaciones/:id/pdf]', err.message);
    res.status(status).json({ ok: false, error: status === 400 ? err.message : 'Error al servir el PDF' });
  }
});

// GET /api/rrhh/reportes-compartidos
router.get('/reportes-compartidos', async (req, res) => {
  try {
    const reportesBase = await parseReportesFromRequest(req);
    const soloConDiferencias = parseBoolean(req.query.solo_con_diferencias);
    const folio = String(req.query.folio || '').trim();

    let reportes = reportesBase;
    if (soloConDiferencias) {
      reportes = reportes.filter(reporte => {
        if (reporte.tiene_diferencias) return true;
        const folios = extractFoliosSnapshot(reporte.reporte_json);
        return folios.some(folioRow => Number(folioRow.monto_asignado) <= 0 || Number(folioRow.porcentaje_participacion) <= 0);
      });
    }

    if (folio) {
      reportes = reportes.filter(reporte =>
        extractFoliosSnapshot(reporte.reporte_json).some(item => String(item.folio) === folio)
      );
    }

    res.json({ ok: true, reportes });
  } catch (err) {
    const status = /invalid|inval|año|mes/i.test(String(err.message || '')) ? 400 : 500;
    console.error('[GET /api/rrhh/reportes-compartidos]', err.message);
    res.status(status).json({ ok: false, error: status === 400 ? err.message : 'Error al obtener reportes compartidos' });
  }
});

// GET /api/rrhh/reportes-compartidos/:id
router.get('/reportes-compartidos/:id', async (req, res) => {
  try {
    const id = validateId(req.params.id);
    const reporte = await obtenerReporteCompartidoPorId(id);
    if (!reporte) {
      return res.status(404).json({ ok: false, error: 'Reporte compartido no encontrado' });
    }

    res.json({
      ok: true,
      cabecera: {
        id: reporte.id,
        vendedor_usuario_id: reporte.vendedor_usuario_id,
        vendedor_nombre: reporte.vendedor_nombre,
        vendedor_email: reporte.vendedor_email,
        anio: reporte.anio,
        mes: reporte.mes,
        periodo_label: reporte.periodo_label,
        total_venta: reporte.total_venta,
        total_venta_real: reporte.total_venta_real,
        total_descuento: reporte.total_descuento,
        total_comision: reporte.total_comision,
        cantidad_folios: reporte.cantidad_folios,
        cantidad_lineas: reporte.cantidad_lineas,
        estado: reporte.estado,
        confirmado_at: reporte.confirmado_at,
        revisado_at: reporte.revisado_at,
        comentario_rrhh: reporte.comentario_rrhh,
        motivo_rechazo: reporte.motivo_rechazo,
        rechazado_at: reporte.rechazado_at,
        rechazado_por: reporte.rechazado_por,
        confirmado_por_nombre: reporte.confirmado_por_nombre,
        revisado_por: reporte.revisado_por,
        rechazado_por_nombre: reporte.rechazado_por_nombre,
      },
      resumen: {
        cantidad_folios: reporte.cantidad_folios,
        cantidad_lineas: reporte.cantidad_lineas,
        total_venta: reporte.total_venta,
        total_venta_real: reporte.total_venta_real,
        total_descuento: reporte.total_descuento,
        total_comision: reporte.total_comision,
      },
      reporte_json: reporte.reporte_json || null,
      folios_asignados: extractFoliosSnapshot(reporte.reporte_json),
      estado: reporte.estado,
      comentario_rrhh: reporte.comentario_rrhh,
      motivo_rechazo: reporte.motivo_rechazo,
      historial: [
        {
          estado: 'confirmado_vendedor',
          fecha: reporte.confirmado_at,
          usuario: reporte.confirmado_por_nombre || null,
        },
        reporte.revisado_at
          ? {
              estado: reporte.estado,
              fecha: reporte.revisado_at,
              usuario: reporte.revisado_por_nombre || null,
              comentario: reporte.comentario_rrhh || null,
            }
          : reporte.rechazado_at
            ? {
                estado: reporte.estado,
                fecha: reporte.rechazado_at,
                usuario: reporte.rechazado_por_nombre || null,
                comentario: reporte.motivo_rechazo || null,
              }
            : null,
      ].filter(Boolean),
    });
  } catch (err) {
    const status = /invalid|inval/i.test(String(err.message || '')) ? 400 : 500;
    console.error('[GET /api/rrhh/reportes-compartidos/:id]', err.message);
    res.status(status).json({ ok: false, error: status === 400 ? err.message : 'Error al obtener el detalle del reporte' });
  }
});

// GET /api/rrhh/ventas-compartidas/revision
router.get('/ventas-compartidas/revision', async (req, res) => {
  try {
    const anio = parsePositiveInteger(req.query.anio, 'Año', { min: 2026, max: 2100 });
    const mes = parsePositiveInteger(req.query.mes, 'Mes', { min: 1, max: 12 });
    if (!anio || !mes) {
      return res.status(400).json({ ok: false, error: 'Año y mes son obligatorios' });
    }

    console.info('[rrhh revision compartidas] periodo', { anio, mes });
    console.info('[rrhh revision compartidas] codigos compartidos:', CODIGOS_VENDEDORES_COMPARTIDOS.join(','));

    const revision = await obtenerRevisionVentasCompartidas({
      anio,
      mes,
      vendedorAsignadorId: parsePositiveInteger(req.query.vendedor_asignador_id, 'Vendedor asignador'),
      vendedorAsignadoId: parsePositiveInteger(req.query.vendedor_asignado_id, 'Vendedor asignado'),
      estado: req.query.estado ? String(req.query.estado).trim() : null,
      folio: req.query.folio ? String(req.query.folio).trim() : null,
      cliente: req.query.cliente ? String(req.query.cliente).trim() : null,
      soloDiferencias: parseBoolean(req.query.solo_diferencias),
    });

    console.info('[rrhh revision compartidas] folios Softland:', Array.isArray(revision.folios_softland) ? revision.folios_softland.length : 0);
    console.info('[rrhh revision compartidas] folios asignados MySQL:', Array.isArray(revision.folios_asignados) ? revision.folios_asignados.length : 0);
    console.info('[rrhh revision compartidas] reportes confirmados:', Array.isArray(revision.reportes_confirmados) ? revision.reportes_confirmados.length : 0);

    res.json({ ok: true, ...revision });
  } catch (err) {
    const status = /invalid|inval|oblig/i.test(String(err.message || '')) ? 400 : 500;
    console.error('[GET /api/rrhh/ventas-compartidas/revision]', err.message);
    res.status(status).json({ ok: false, error: status === 400 ? err.message : 'Error al obtener la revision consolidada' });
  }
});

// PATCH /api/rrhh/reportes-compartidos/:id/validar
router.patch('/reportes-compartidos/:id/validar', async (req, res) => {
  try {
    const id = validateId(req.params.id);
    const comentario = String(req.body?.comentario_rrhh || '').trim();
    const usuarioId = Number(req.usuario?.id ?? req.usuario?.sub);
    const reporte = await obtenerReporteCompartidoPorId(id);
    if (!reporte) {
      return res.status(404).json({ ok: false, error: 'Reporte compartido no encontrado' });
    }
    if (String(reporte.estado || '') === 'validado_rrhh') {
      return res.status(409).json({ ok: false, code: 'REPORTE_YA_VALIDADO', error: 'Este reporte ya fue validado.' });
    }
    if (String(reporte.estado || '') === 'rechazado_rrhh') {
      return res.status(409).json({ ok: false, code: 'REPORTE_YA_RECHAZADO', error: 'Este reporte ya fue rechazado.' });
    }
    await actualizarEstadoReporteCompartido({
      id,
      estado: 'validado_rrhh',
      comentarioRrhh: comentario || null,
      revisadoPor: usuarioId,
    });
    if (reporte.vendedor_usuario_id) {
      const periodo = reporte.periodo_label || `${reporte.mes || ''} ${reporte.anio || ''}`.trim();
      await notificarUsuario({
        usuarioId: reporte.vendedor_usuario_id,
        tipo: 'reporte_compartido_validado',
        titulo: 'Reporte de ventas compartidas validado',
        mensaje: `RRHH validó tu reporte de ventas compartidas de ${periodo}.`,
        mes: reporte.mes,
        anio: reporte.anio,
        folio: String(reporte.id || ''),
      });
    }
    res.json({ ok: true, message: 'Reporte validado correctamente' });
  } catch (err) {
    const status = /invalid|inval/i.test(String(err.message || '')) ? 400 : 500;
    console.error('[PATCH /api/rrhh/reportes-compartidos/:id/validar]', err.message);
    res.status(status).json({ ok: false, error: status === 400 ? err.message : 'Error al validar el reporte' });
  }
});

// PATCH /api/rrhh/reportes-compartidos/:id/rechazar
router.patch('/reportes-compartidos/:id/rechazar', async (req, res) => {
  try {
    const id = validateId(req.params.id);
    const motivo = String(req.body?.motivo_rechazo || req.body?.comentario_rrhh || '').trim();
    if (motivo.length < 5) {
      return res.status(400).json({ ok: false, error: 'Debes indicar el motivo del rechazo.' });
    }
    const usuarioId = Number(req.usuario?.id ?? req.usuario?.sub);
    const reporte = await obtenerReporteCompartidoPorId(id);
    if (!reporte) {
      return res.status(404).json({ ok: false, error: 'Reporte compartido no encontrado' });
    }
    if (String(reporte.estado || '') === 'rechazado_rrhh') {
      return res.status(409).json({ ok: false, code: 'REPORTE_YA_RECHAZADO', error: 'Este reporte ya fue rechazado.' });
    }
    if (String(reporte.estado || '') === 'validado_rrhh') {
      return res.status(409).json({ ok: false, code: 'REPORTE_YA_VALIDADO', error: 'Este reporte ya fue validado.' });
    }
    await actualizarEstadoReporteCompartido({
      id,
      estado: 'rechazado_rrhh',
      motivoRechazo: motivo,
      rechazadoPor: usuarioId,
    });

    if (reporte.vendedor_usuario_id) {
      const periodo = reporte.periodo_label || `${reporte.mes || ''} ${reporte.anio || ''}`.trim();
      await notificarUsuario({
        usuarioId: reporte.vendedor_usuario_id,
        tipo: 'reporte_compartido_rechazado',
        titulo: 'Reporte de ventas compartidas rechazado',
        mensaje: `RRHH rechazó tu reporte de ventas compartidas de ${periodo}. Motivo: ${motivo}`,
        mes: reporte.mes,
        anio: reporte.anio,
        folio: String(reporte.id || ''),
      });
    }

    res.json({ ok: true, message: 'Reporte rechazado correctamente' });
  } catch (err) {
    const status = /invalid|inval/i.test(String(err.message || '')) ? 400 : 500;
    console.error('[PATCH /api/rrhh/reportes-compartidos/:id/rechazar]', err.message);
    res.status(status).json({ ok: false, error: status === 400 ? err.message : 'Error al rechazar el reporte' });
  }
});

module.exports = router;

