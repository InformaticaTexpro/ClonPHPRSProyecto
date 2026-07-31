'use strict';
/**
 * models/reporteCompartido.js
 * Persistencia para snapshots de ventas compartidas confirmadas por vendedor.
 */

const db = require('../config/db');
const { getSoftlandPool, sql } = require('../config/db.softland');
const { CODIGOS_VENDEDORES_COMPARTIDOS } = require('../config/ventasCompartidas');

const TABLE_NAME = 'reporte_venta_compartida_confirmacion';

function parseReporteJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function safeJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function buildPeriodoLabel(anio, mes) {
  const fecha = new Date(Number(anio), Number(mes) - 1, 1);
  const label = fecha.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function normalizeCodigo(value) {
  return String(value || '').trim();
}

function normalizeName(value) {
  return String(value || '').trim();
}

function normalizeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractSnapshotFolios(reporteJson) {
  const folios = Array.isArray(reporteJson?.folios_asignados)
    ? reporteJson.folios_asignados
    : Array.isArray(reporteJson?.detalle)
      ? reporteJson.detalle
      : [];

  return folios
    .map(item => ({
      folio: normalizeCodigo(item?.folio),
      fecha: normalizeCodigo(item?.fecha),
      cliente: normalizeName(item?.cliente),
      vendedor_asignado: normalizeName(item?.vendedor_asignado || item?.nombre_vendedor_compartido || item?.cod_vendedor_compartido),
      vendedor_asignador: normalizeName(item?.vendedor_asignador || item?.vendedor_origen || item?.cod_vendedor_principal),
      porcentaje_participacion: normalizeNumber(item?.porcentaje_participacion ?? item?.porcentaje ?? 0),
      monto_asignado: normalizeNumber(item?.monto_asignado ?? item?.monto ?? 0),
    }))
    .filter(item => item.folio);
}

function tieneDiferenciasSnapshot(reporteJson) {
  const diferencias = Array.isArray(reporteJson?.comparacion)
    ? reporteJson.comparacion
    : Array.isArray(reporteJson?.diferencias)
      ? reporteJson.diferencias
      : [];
  if (diferencias.length) return true;

  const folios = extractSnapshotFolios(reporteJson);
  return folios.some(folio => {
    const monto = normalizeNumber(folio.monto_asignado);
    const porcentaje = normalizeNumber(folio.porcentaje_participacion);
    return monto === 0 || porcentaje === 0;
  });
}

function enrichReporteRow(row) {
  if (!row) return null;
  const reporteJson = parseReporteJson(row.reporte_json);
  const foliosAsignados = extractSnapshotFolios(reporteJson);
  return {
    ...row,
    reporte_json: reporteJson,
    folios_asignados: foliosAsignados,
    tiene_diferencias: tieneDiferenciasSnapshot(reporteJson),
  };
}

async function obtenerCodigosVendedorPorUsuarioId(usuarioId) {
  if (!usuarioId) return [];
  const [rows] = await db.query(
    `SELECT DISTINCT TRIM(cod_vendedor) AS cod_vendedor
     FROM usuario_vendedor
     WHERE usuario_id = ? AND cod_vendedor IS NOT NULL AND TRIM(cod_vendedor) <> ''`,
    [usuarioId]
  );
  return rows.map(row => normalizeCodigo(row.cod_vendedor)).filter(Boolean);
}

async function obtenerVendedoresCompartidosPorCodigos(codigosCompartidos = CODIGOS_VENDEDORES_COMPARTIDOS) {
  const codigosNormalizados = Array.from(
    new Set(
      (Array.isArray(codigosCompartidos) ? codigosCompartidos : CODIGOS_VENDEDORES_COMPARTIDOS)
        .map(normalizeCodigo)
        .filter(Boolean)
    )
  );

  if (!codigosNormalizados.length) return [];

  const placeholders = codigosNormalizados.map(() => '?').join(',');
  const [rows] = await db.query(
    `
    SELECT DISTINCT
      uv.usuario_id,
      TRIM(uv.cod_vendedor) AS cod_vendedor,
      COALESCE(NULLIF(TRIM(u.nombre), ''), TRIM(uv.cod_vendedor)) AS nombre
    FROM usuario_vendedor uv
    LEFT JOIN usuario u ON u.id = uv.usuario_id
    WHERE TRIM(uv.cod_vendedor) IN (${placeholders})
      AND (u.is_active = 1 OR u.id IS NULL)
    ORDER BY nombre ASC, cod_vendedor ASC
    `,
    codigosNormalizados
  );

  return rows.map(row => ({
    usuario_id: row.usuario_id ? Number(row.usuario_id) : null,
    cod_vendedor: normalizeCodigo(row.cod_vendedor),
    nombre: normalizeName(row.nombre),
  }));
}

async function guardarReporteCompartidoConfirmado({
  vendedorUsuarioId,
  vendedorNombre,
  vendedorEmail,
  anio,
  mes,
  totalVenta,
  totalVentaReal,
  totalDescuento,
  totalComision,
  cantidadFolios,
  cantidadLineas,
  reporteJson,
  reportePdfPath = null,
  confirmadoPor,
}) {
  const periodoLabel = buildPeriodoLabel(anio, mes);
  const reporteJsonString = safeJson(reporteJson);

  const [result] = await db.query(
    `INSERT INTO ${TABLE_NAME}
      (vendedor_usuario_id, vendedor_nombre, vendedor_email, anio, mes, periodo_label,
       total_venta, total_venta_real, total_descuento, total_comision,
       cantidad_folios, cantidad_lineas, reporte_json, reporte_pdf_path,
       estado, confirmado_por, confirmado_at,
       revisado_por, revisado_at, comentario_rrhh,
       rechazado_por, rechazado_at, motivo_rechazo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             'confirmado_vendedor', ?, NOW(),
             NULL, NULL, NULL,
             NULL, NULL, NULL)
     ON DUPLICATE KEY UPDATE
       vendedor_nombre = VALUES(vendedor_nombre),
       vendedor_email = VALUES(vendedor_email),
       periodo_label = VALUES(periodo_label),
       total_venta = VALUES(total_venta),
       total_venta_real = VALUES(total_venta_real),
       total_descuento = VALUES(total_descuento),
       total_comision = VALUES(total_comision),
       cantidad_folios = VALUES(cantidad_folios),
       cantidad_lineas = VALUES(cantidad_lineas),
       reporte_json = VALUES(reporte_json),
       reporte_pdf_path = VALUES(reporte_pdf_path),
       estado = 'confirmado_vendedor',
       confirmado_por = VALUES(confirmado_por),
       confirmado_at = NOW(),
       revisado_por = NULL,
       revisado_at = NULL,
       comentario_rrhh = NULL,
       rechazado_por = NULL,
       rechazado_at = NULL,
       motivo_rechazo = NULL`,
    [
      vendedorUsuarioId,
      vendedorNombre,
      vendedorEmail || null,
      Number(anio),
      Number(mes),
      periodoLabel,
      Number(totalVenta) || 0,
      Number(totalVentaReal) || 0,
      Number(totalDescuento) || 0,
      Number(totalComision) || 0,
      Number(cantidadFolios) || 0,
      Number(cantidadLineas) || 0,
      reporteJsonString,
      reportePdfPath,
      confirmadoPor,
    ]
  );

  return result.insertId || result.affectedRows || 0;
}

async function obtenerReporteCompartidoUsuarioPeriodo(vendedorUsuarioId, anio, mes) {
  const [rows] = await db.query(
    `SELECT *
     FROM ${TABLE_NAME}
     WHERE vendedor_usuario_id = ? AND anio = ? AND mes = ?
     LIMIT 1`,
    [vendedorUsuarioId, Number(anio), Number(mes)]
  );
  return enrichReporteRow(rows[0] || null);
}

async function obtenerReporteCompartidoPorId(id) {
  const [rows] = await db.query(
    `SELECT r.*, u.nombre AS confirmado_por_nombre,
            ur.nombre AS revisado_por_nombre,
            ur2.nombre AS rechazado_por_nombre
     FROM ${TABLE_NAME} r
     LEFT JOIN usuario u ON u.id = r.confirmado_por
     LEFT JOIN usuario ur ON ur.id = r.revisado_por
     LEFT JOIN usuario ur2 ON ur2.id = r.rechazado_por
     WHERE r.id = ?
     LIMIT 1`,
    [id]
  );
  return enrichReporteRow(rows[0] || null);
}

async function listarReportesCompartidos({
  anio = null,
  mes = null,
  estado = null,
  vendedor = null,
  desde = null,
  hasta = null,
  vendedorUsuarioId = null,
  vendedorNombre = null,
  folio = null,
} = {}) {
  const where = [];
  const params = [];

  if (anio) {
    where.push('r.anio = ?');
    params.push(Number(anio));
  }
  if (mes) {
    where.push('r.mes = ?');
    params.push(Number(mes));
  }
  if (estado && estado !== 'todos') {
    where.push('r.estado = ?');
    params.push(String(estado));
  }
  if (vendedor) {
    where.push('(LOWER(r.vendedor_nombre) LIKE ? OR LOWER(COALESCE(r.vendedor_email, "")) LIKE ?)');
    const q = `%${String(vendedor).trim().toLowerCase()}%`;
    params.push(q, q);
  }
  if (vendedorUsuarioId) {
    where.push('r.vendedor_usuario_id = ?');
    params.push(Number(vendedorUsuarioId));
  }
  if (vendedorNombre) {
    where.push('(LOWER(r.vendedor_nombre) LIKE ? OR LOWER(COALESCE(r.vendedor_email, "")) LIKE ?)');
    const q = `%${String(vendedorNombre).trim().toLowerCase()}%`;
    params.push(q, q);
  }
  if (desde) {
    where.push('DATE(r.confirmado_at) >= ?');
    params.push(desde);
  }
  if (hasta) {
    where.push('DATE(r.confirmado_at) <= ?');
    params.push(hasta);
  }

  const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await db.query(
    `SELECT
       r.id,
       r.vendedor_usuario_id,
       r.vendedor_nombre,
       r.vendedor_email,
       r.anio,
       r.mes,
       r.periodo_label,
       r.total_venta,
       r.total_venta_real,
       r.total_descuento,
       r.total_comision,
       r.cantidad_folios,
       r.cantidad_lineas,
       r.estado,
       r.confirmado_at,
       r.revisado_at,
       r.comentario_rrhh,
       r.rechazado_at,
       r.rechazado_por,
       r.motivo_rechazo,
       r.reporte_pdf_path,
       r.confirmado_por,
       r.revisado_por,
       r.created_at,
       r.updated_at,
       u.nombre AS confirmado_por_nombre,
       ur.nombre AS revisado_por_nombre,
       ur2.nombre AS rechazado_por_nombre
     FROM ${TABLE_NAME} r
     LEFT JOIN usuario u ON u.id = r.confirmado_por
     LEFT JOIN usuario ur ON ur.id = r.revisado_por
     LEFT JOIN usuario ur2 ON ur2.id = r.rechazado_por
     ${sqlWhere}
     ORDER BY r.confirmado_at DESC, r.id DESC`,
    params
  );

  let result = rows.map(enrichReporteRow);

  if (folio) {
    const folioBuscado = normalizeCodigo(folio);
    result = result.filter(reporte => {
      if (!reporte) return false;
      const folios = extractSnapshotFolios(reporte.reporte_json);
      return folios.some(item => normalizeCodigo(item.folio) === folioBuscado);
    });
  }

  return result;
}

async function actualizarEstadoReporteCompartido({
  id,
  estado,
  comentarioRrhh = null,
  motivoRechazo = null,
  revisadoPor = null,
  rechazadoPor = null,
}) {
  let sql;
  let params;

  if (estado === 'rechazado_rrhh') {
    sql = `UPDATE ${TABLE_NAME}
           SET estado = ?,
               comentario_rrhh = NULL,
               motivo_rechazo = ?,
               revisado_por = NULL,
               revisado_at = NULL,
               rechazado_por = ?,
               rechazado_at = NOW()
           WHERE id = ?`;
    params = [estado, motivoRechazo, rechazadoPor, id];
  } else {
    sql = `UPDATE ${TABLE_NAME}
           SET estado = ?,
               comentario_rrhh = ?,
               motivo_rechazo = NULL,
               revisado_por = ?,
               revisado_at = NOW(),
               rechazado_por = NULL,
               rechazado_at = NULL
           WHERE id = ?`;
    params = [estado, comentarioRrhh, revisadoPor, id];
  }

  const [result] = await db.query(sql, params);
  return result.affectedRows > 0;
}

async function listarFoliosSoftlandCompartidos({
  anio,
  mes,
  codigosCompartidos = CODIGOS_VENDEDORES_COMPARTIDOS,
  folio = null,
  cliente = null,
} = {}) {
  const codigosNormalizados = Array.from(
    new Set(
      (Array.isArray(codigosCompartidos) ? codigosCompartidos : CODIGOS_VENDEDORES_COMPARTIDOS)
        .map(normalizeCodigo)
        .filter(Boolean)
    )
  );

  if (!codigosNormalizados.length) return [];

  const pool = await getSoftlandPool();
  const request = pool.request();
  const fechaInicio = new Date(Number(anio), Number(mes) - 1, 1);
  const fechaFin = new Date(Number(anio), Number(mes), 1);
  request.input('fechaInicio', sql.DateTime, fechaInicio);
  request.input('fechaFin', sql.DateTime, fechaFin);
  codigosNormalizados.forEach((codigo, index) => {
    request.input(`cod${index}`, sql.VarChar(20), codigo);
  });

  const filtroCodigo = codigosNormalizados.map((_, index) => `@cod${index}`).join(',');
  const filtroFolio = folio != null && String(folio).trim() !== '' ? 'AND CAST(h.Folio AS VARCHAR(20)) = @folio' : '';
  const filtroCliente = cliente != null && String(cliente).trim() !== ''
    ? (() => {
        request.input('cliente', sql.VarChar(200), `%${String(cliente).trim()}%`);
        return 'AND RTRIM(COALESCE(c.NomAux, \'\')) LIKE @cliente';
      })()
    : '';

  if (filtroFolio) {
    request.input('folio', sql.VarChar(20), String(folio).trim());
  }

  const result = await request.query(`
    SELECT
      h.Folio,
      CONVERT(VARCHAR(10), h.Fecha, 120) AS fecha_iso,
      CONVERT(VARCHAR(10), h.Fecha, 103) AS fecha,
      h.CodVendedor AS cod_vendedor_softland,
      COALESCE(vend.VenDes, h.CodVendedor) AS vendedor_softland,
      RTRIM(COALESCE(c.NomAux, '')) AS cliente,
      ROUND(SUM(m.TotLinea), 0) AS total_softland
    FROM [PRODIN].[softland].[iw_gsaen] h
    INNER JOIN [PRODIN].[softland].[iw_gmovi] m
      ON m.NroInt = h.NroInt
     AND m.Tipo = h.Tipo
    LEFT JOIN [PRODIN].[softland].[cwtauxi] c
      ON c.CodAux = h.CodAux
    LEFT JOIN [PRODIN].[softland].[cwtvend] vend
      ON vend.VenCod = h.CodVendedor
    WHERE h.CodVendedor IN (${filtroCodigo})
      AND h.Estado <> 'A'
      AND h.Tipo = 'F'
      AND h.Fecha >= @fechaInicio
      AND h.Fecha < @fechaFin
      ${filtroFolio}
      ${filtroCliente}
    GROUP BY h.Folio, h.Fecha, h.CodVendedor, vend.VenDes, c.NomAux
    ORDER BY h.Fecha DESC, h.Folio DESC
  `);

  return result.recordset.map(row => ({
    folio: normalizeCodigo(row.Folio),
    fecha: normalizeCodigo(row.fecha_iso || row.fecha),
    fecha_formato: normalizeCodigo(row.fecha),
    cliente: normalizeName(row.cliente),
    cod_vendedor_softland: normalizeCodigo(row.cod_vendedor_softland),
    vendedor_softland: normalizeName(row.vendedor_softland) || `Código compartido ${normalizeCodigo(row.cod_vendedor_softland)}`,
    total_softland: normalizeNumber(row.total_softland),
    existe_softland: true,
  }));
}

async function listarFoliosAsignadosRevision({
  anio,
  mes,
  codigosAsignador = [],
  codigosAsignado = [],
  folio = null,
} = {}) {
  const where = ['fc.rol = \'compartido\''];
  const params = [];

  if (anio != null) {
    where.push('fc.anio = ?');
    params.push(Number(anio));
  }
  if (mes != null) {
    where.push('fc.mes = ?');
    params.push(Number(mes));
  }
  if (folio != null && String(folio).trim() !== '') {
    where.push('CAST(fc.folio AS CHAR) = ?');
    params.push(String(folio).trim());
  }

  const asignadorCodes = Array.from(new Set((Array.isArray(codigosAsignador) ? codigosAsignador : []).map(normalizeCodigo).filter(Boolean)));
  const asignadoCodes = Array.from(new Set((Array.isArray(codigosAsignado) ? codigosAsignado : []).map(normalizeCodigo).filter(Boolean)));

  if (asignadorCodes.length) {
    where.push(`fc.cod_vendedor_principal IN (${asignadorCodes.map(() => '?').join(',')})`);
    params.push(...asignadorCodes);
  }
  if (asignadoCodes.length) {
    where.push(`fc.cod_vendedor_compartido IN (${asignadoCodes.map(() => '?').join(',')})`);
    params.push(...asignadoCodes);
  }

  const [rows] = await db.query(
    `
    SELECT
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
      fc.rol,
      uvo.usuario_id AS vendedor_asignador_id,
      uva.usuario_id AS vendedor_asignado_id,
      COALESCE(uo.nombre, fc.cod_vendedor_principal) AS vendedor_asignador,
      COALESCE(ua.nombre, fc.nombre_vendedor_compartido, fc.cod_vendedor_compartido) AS vendedor_asignado
    FROM factura_compartida fc
    LEFT JOIN usuario_vendedor uvo ON uvo.cod_vendedor = fc.cod_vendedor_principal
    LEFT JOIN usuario uo ON uo.id = uvo.usuario_id
    LEFT JOIN usuario_vendedor uva ON uva.cod_vendedor = fc.cod_vendedor_compartido
    LEFT JOIN usuario ua ON ua.id = uva.usuario_id
    WHERE ${where.join(' AND ')}
    ORDER BY fc.fecha DESC, fc.folio DESC, fc.id DESC
    `,
    params
  );

  return rows.map(row => ({
    id: Number(row.id),
    folio: normalizeCodigo(row.folio),
    fecha: normalizeCodigo(row.fecha),
    cliente: normalizeName(row.cliente),
    monto_neto: normalizeNumber(row.monto_neto),
    monto_asignado: normalizeNumber(row.monto_asignado),
    porcentaje: normalizeNumber(row.porcentaje),
    cod_vendedor_principal: normalizeCodigo(row.cod_vendedor_principal),
    cod_vendedor_compartido: normalizeCodigo(row.cod_vendedor_compartido),
    vendedor_asignador_id: row.vendedor_asignador_id ? Number(row.vendedor_asignador_id) : null,
    vendedor_asignado_id: row.vendedor_asignado_id ? Number(row.vendedor_asignado_id) : null,
    nombre_vendedor_compartido: normalizeName(row.nombre_vendedor_compartido),
    vendedor_asignador: normalizeName(row.vendedor_asignador),
    vendedor_asignado: normalizeName(row.vendedor_asignado),
    mes: Number(row.mes) || null,
    anio: Number(row.anio) || null,
    rol: normalizeName(row.rol),
    existe_asignacion: true,
  }));
}

function compararReporteConSnapshots({ foliosSoftland, asignaciones, reportes }) {
  const softlandByFolio = new Map();
  const asignacionesByFolio = new Map();
  const reportesByFolio = new Map();
  const reportesPorId = new Map();

  (foliosSoftland || []).forEach(row => {
    const folio = normalizeCodigo(row.folio);
    if (!folio || softlandByFolio.has(folio)) return;
    softlandByFolio.set(folio, row);
  });

  (asignaciones || []).forEach(row => {
    const folio = normalizeCodigo(row.folio);
    if (!folio) return;
    if (!asignacionesByFolio.has(folio)) asignacionesByFolio.set(folio, []);
    asignacionesByFolio.get(folio).push(row);
  });

  (reportes || []).forEach(reporte => {
    reportesPorId.set(Number(reporte.id), reporte);
    const folios = extractSnapshotFolios(reporte.reporte_json);
    folios.forEach(folioRow => {
      const folio = normalizeCodigo(folioRow.folio);
      if (!folio) return;
      if (!reportesByFolio.has(folio)) reportesByFolio.set(folio, []);
      reportesByFolio.get(folio).push({
        reporte,
        folio: folioRow,
      });
    });
  });

  const allFolios = new Set([
    ...softlandByFolio.keys(),
    ...asignacionesByFolio.keys(),
    ...reportesByFolio.keys(),
  ]);

  const comparacion = Array.from(allFolios).map(folio => {
    const softlandRow = softlandByFolio.get(folio) || null;
    const asignacionRows = asignacionesByFolio.get(folio) || [];
    const reportesRows = reportesByFolio.get(folio) || [];
    const asignacionRow = asignacionRows[0] || null;
    const reporteItem = reportesRows[0] || null;
    const reporte = reporteItem?.reporte || null;
    const snapshot = reporteItem?.folio || null;
    const diferencias = [];

    if (softlandRow && !asignacionRow) {
      diferencias.push('Folio de código compartido sin asignación registrada.');
    }

    if (asignacionRow && !reporteItem) {
      diferencias.push('Folio asignado no incluido en reporte confirmado.');
    }

    if (!softlandRow && reporteItem) {
      diferencias.push('Folio reportado no encontrado en Softland para códigos compartidos.');
    }

    if (reportesRows.length > 1) {
      diferencias.push('Folio duplicado en reporte confirmado.');
    }

    if (asignacionRow && snapshot) {
      const montoAsignado = normalizeNumber(asignacionRow.monto_asignado);
      const montoSnapshot = normalizeNumber(snapshot.monto_asignado);
      const porcentajeAsignado = normalizeNumber(asignacionRow.porcentaje);
      const porcentajeSnapshot = normalizeNumber(snapshot.porcentaje_participacion);

      if (montoAsignado !== montoSnapshot) {
        diferencias.push('Monto asignado distinto al reportado.');
      }

      if (porcentajeAsignado !== porcentajeSnapshot) {
        diferencias.push('Porcentaje de participación distinto al reportado.');
      }
    }

    return {
      folio,
      fecha: softlandRow?.fecha_iso || softlandRow?.fecha || asignacionRow?.fecha || snapshot?.fecha || null,
      cliente: softlandRow?.cliente || asignacionRow?.cliente || snapshot?.cliente || '',
      cod_vendedor_softland: softlandRow?.cod_vendedor_softland || '',
      vendedor_softland: softlandRow?.vendedor_softland || '',
      vendedor_asignador: softlandRow ? (asignacionRow?.vendedor_asignador || '') : (asignacionRow?.vendedor_asignador || ''),
      vendedor_asignado: asignacionRow?.vendedor_asignado || snapshot?.vendedor_asignado || asignacionRow?.nombre_vendedor_compartido || '',
      porcentaje_participacion: normalizeNumber(asignacionRow?.porcentaje ?? snapshot?.porcentaje_participacion ?? 0),
      monto_asignado: normalizeNumber(asignacionRow?.monto_asignado ?? snapshot?.monto_asignado ?? 0),
      total_softland: normalizeNumber(softlandRow?.total_softland ?? 0),
      existe_softland: Boolean(softlandRow),
      existe_asignacion: Boolean(asignacionRow),
      incluido_en_reporte: Boolean(reporteItem),
      reporte_id: reporte?.id || null,
      estado_reporte: reporte?.estado || null,
      diferencias,
      total_reportes: reportesRows.length,
      reporte_confirmado_at: reporte?.confirmado_at || null,
    };
  });

  const resumen = {
    folios_softland_compartidos: softlandByFolio.size,
    folios_asignados: asignacionesByFolio.size,
    folios_reportados: reportesByFolio.size,
    folios_faltantes_asignacion: comparacion.filter(item => item.existe_softland && !item.existe_asignacion).length,
    folios_faltantes_reporte: comparacion.filter(item => item.existe_asignacion && !item.incluido_en_reporte).length,
    reportes_pendientes_rrhh: (reportes || []).filter(item => String(item.estado || '') === 'confirmado_vendedor').length,
    reportes_validados: (reportes || []).filter(item => String(item.estado || '') === 'validado_rrhh').length,
    reportes_rechazados: (reportes || []).filter(item => String(item.estado || '') === 'rechazado_rrhh').length,
    diferencias_detectadas: comparacion.filter(item => Array.isArray(item.diferencias) && item.diferencias.length > 0).length,
  };

  return {
    comparacion,
    resumen,
    foliosSoftland: Array.from(softlandByFolio.values()),
    asignaciones,
    reportes,
  };
}

async function obtenerRevisionVentasCompartidas({
  anio,
  mes,
  vendedorAsignadorId = null,
  vendedorAsignadoId = null,
  estado = null,
  folio = null,
  cliente = null,
  soloDiferencias = false,
} = {}) {
  const [codigosAsignadorRows, codigosAsignadoRows] = await Promise.all([
    obtenerCodigosVendedorPorUsuarioId(vendedorAsignadorId),
    obtenerCodigosVendedorPorUsuarioId(vendedorAsignadoId),
  ]);
  const vendedoresCompartidos = await obtenerVendedoresCompartidosPorCodigos();
  const reportes = await listarReportesCompartidos({
    anio,
    mes,
    estado,
    folio,
    vendedorUsuarioId: vendedorAsignadoId,
  });

  const foliosSoftland = await listarFoliosSoftlandCompartidos({
    anio,
    mes,
    codigosCompartidos: CODIGOS_VENDEDORES_COMPARTIDOS,
    folio,
    cliente,
  });

  const asignaciones = await listarFoliosAsignadosRevision({
    anio,
    mes,
    codigosAsignador: codigosAsignadorRows,
    codigosAsignado: codigosAsignadoRows,
    folio,
  });

  const comparacion = compararReporteConSnapshots({
    foliosSoftland,
    asignaciones,
    reportes,
  });

  const comparacionFiltrada = soloDiferencias
    ? comparacion.comparacion.filter(item => Array.isArray(item.diferencias) && item.diferencias.length > 0)
    : comparacion.comparacion;

  return {
    periodo: {
      anio: Number(anio),
      mes: Number(mes),
      label: buildPeriodoLabel(anio, mes),
    },
    codigos_compartidos: [...CODIGOS_VENDEDORES_COMPARTIDOS],
    resumen: {
      ...comparacion.resumen,
      folios_softland: comparacion.resumen.folios_softland_compartidos,
    },
    folios_softland_compartidos: comparacion.foliosSoftland,
    folios_softland: comparacion.foliosSoftland,
    folios_tipo_c: comparacion.foliosSoftland,
    folios_asignados: comparacion.asignaciones,
    reportes_confirmados: comparacion.reportes,
    comparacion: comparacionFiltrada,
    vendedores_compartidos: vendedoresCompartidos,
  };
}

module.exports = {
  guardarReporteCompartidoConfirmado,
  obtenerReporteCompartidoUsuarioPeriodo,
  obtenerReporteCompartidoPorId,
  listarReportesCompartidos,
  actualizarEstadoReporteCompartido,
  listarFoliosSoftlandCompartidos,
  listarFoliosTipoCCompartidos: listarFoliosSoftlandCompartidos,
  listarFoliosAsignadosRevision,
  obtenerRevisionVentasCompartidas,
  obtenerCodigosVendedorPorUsuarioId,
  obtenerVendedoresCompartidosPorCodigos,
};

