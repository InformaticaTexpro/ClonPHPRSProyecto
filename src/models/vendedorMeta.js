'use strict';

const db = require('../config/db');

function resolveClient(source) {
  if (!source) return db.pool;
  if (typeof source.query === 'function') return source;
  if (source.pool && typeof source.pool.query === 'function') return source.pool;
  return db.pool;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeTipoPeriodo(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'mensual' || normalized === 'mes' || normalized === 'm') return 'mensual';
  if (normalized === 'anual' || normalized === 'a') return 'anual';
  return '';
}

function normalizeNumero(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function buildFechaPeriodo(tipoPeriodo, anio, mes) {
  const tipo = normalizeTipoPeriodo(tipoPeriodo) || 'mensual';
  const year = normalizeNumero(anio, new Date().getFullYear());
  const month = tipo === 'anual' ? 1 : Math.min(Math.max(normalizeNumero(mes, 1), 1), 12);
  return `${year}-${pad2(month)}-01`;
}

function inferTipoPeriodoFromFecha(fecha) {
  const text = normalizeText(fecha);
  if (!text) return '';
  const [yearPart, monthPart, dayPart] = text.slice(0, 10).split('-').map(part => Number(part));
  if (!Number.isFinite(yearPart) || !Number.isFinite(monthPart) || !Number.isFinite(dayPart)) return '';
  if (monthPart === 1 && dayPart === 1) return 'anual';
  return 'mensual';
}

function formatFecha(value) {
  const text = normalizeText(value);
  return text ? text.slice(0, 10) : null;
}

function normalizeMesFromRow(row) {
  const mesSql = normalizeNumero(row?.mes, NaN);
  if (Number.isFinite(mesSql) && mesSql >= 1 && mesSql <= 12) return mesSql;

  const fecha = formatFecha(row?.fecha);
  const mesFecha = Number(fecha?.slice(5, 7));
  if (Number.isFinite(mesFecha) && mesFecha >= 1 && mesFecha <= 12) return mesFecha;

  return NaN;
}

function mapMetaRow(row) {
  if (!row) return null;
  const tipoPeriodo = normalizeTipoPeriodo(row.tipo_periodo) || inferTipoPeriodoFromFecha(row.fecha) || 'mensual';
  const metaOriginal = normalizeNumero(row.meta, 0);

  return {
    id: row.id != null ? Number(row.id) : null,
    usuario_id: row.usuario_id != null ? Number(row.usuario_id) : null,
    usuario_nombre: normalizeText(row.usuario_nombre),
    usuario_email: normalizeText(row.usuario_email),
    usuario_area: normalizeText(row.usuario_area),
    usuario_codigo: normalizeText(row.usuario_codigo),
    fecha: formatFecha(row.fecha),
    tipo_periodo: tipoPeriodo,
    meta_original: metaOriginal,
    meta_mes: metaOriginal,
    prorrateada: false,
    activo: row.activo === undefined ? true : Boolean(Number(row.activo)),
    observacion: normalizeText(row.observacion),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function resolveArgs(args) {
  if (args.length >= 4) {
    return {
      client: resolveClient(args[0]),
      usuarioId: args[1],
      anio: args[2],
      mes: args[3],
    };
  }

  return {
    client: resolveClient(),
    usuarioId: args[0],
    anio: args[1],
    mes: args[2],
  };
}

function resolveOptionsArgs(args) {
  if (args.length >= 2 && (args[0] || {}).query) {
    return { client: resolveClient(args[0]), options: args[1] || {} };
  }

  return { client: resolveClient(), options: args[0] || {} };
}

async function queryRows(client, sql, params = []) {
  const [rows] = await client.query(sql, params);
  return rows;
}

async function listarMetasVendedor(...args) {
  const { client, options } = resolveOptionsArgs(args);
  const {
    usuarioId = null,
    anio = null,
    activo = null,
    tipoPeriodo = null,
  } = options;

  const where = [];
  const params = [];

  if (usuarioId !== null && usuarioId !== undefined && usuarioId !== '') {
    where.push('vm.usuario_id = ?');
    params.push(normalizeNumero(usuarioId));
  }

  if (anio !== null && anio !== undefined && anio !== '') {
    where.push('YEAR(vm.fecha) = ?');
    params.push(normalizeNumero(anio));
  }

  const tipo = normalizeTipoPeriodo(tipoPeriodo);
  if (tipo) {
    where.push('vm.tipo_periodo = ?');
    params.push(tipo);
  }

  if (activo !== null && activo !== undefined && activo !== '') {
    where.push('vm.activo = ?');
    params.push(normalizeNumero(activo) ? 1 : 0);
  }

  const sql = `
    SELECT
      vm.id,
      vm.usuario_id,
      vm.fecha,
      vm.tipo_periodo,
      vm.meta,
      vm.activo,
      vm.observacion,
      vm.created_at,
      vm.updated_at,
      u.nombre AS usuario_nombre,
      u.email AS usuario_email,
      u.area AS usuario_area,
      u.codigo AS usuario_codigo
    FROM vendedor_meta vm
    LEFT JOIN usuario u ON u.id = vm.usuario_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY
      u.nombre ASC,
      YEAR(vm.fecha) DESC,
      MONTH(vm.fecha) DESC,
      CASE vm.tipo_periodo WHEN 'mensual' THEN 0 WHEN 'anual' THEN 1 ELSE 2 END ASC,
      vm.id DESC
  `;

  const rows = await queryRows(client, sql, params);
  return rows.map(mapMetaRow);
}

async function obtenerMetaVendedor(...args) {
  const { client, usuarioId, anio, mes } = resolveArgs(args);
  const userId = normalizeNumero(usuarioId, 0);
  const year = normalizeNumero(anio, new Date().getFullYear());
  const month = Math.min(Math.max(normalizeNumero(mes, new Date().getMonth() + 1), 1), 12);
  const fechaMes = `${year}-${pad2(month)}-01`;

  const rows = await queryRows(
    client,
    `
      SELECT
        vm.id,
        vm.usuario_id,
        vm.fecha,
        vm.tipo_periodo,
        vm.meta,
        vm.activo,
        vm.observacion,
        vm.created_at,
        vm.updated_at,
        u.nombre AS usuario_nombre,
        u.email AS usuario_email,
        u.area AS usuario_area,
        u.codigo AS usuario_codigo
      FROM vendedor_meta vm
      LEFT JOIN usuario u ON u.id = vm.usuario_id
      WHERE vm.usuario_id = ?
        AND COALESCE(vm.activo, 1) = 1
        AND (
          (vm.tipo_periodo = 'mensual' AND vm.fecha = ?)
          OR
          (vm.tipo_periodo = 'anual' AND YEAR(vm.fecha) = ?)
        )
      ORDER BY
        CASE
          WHEN vm.tipo_periodo = 'mensual' THEN 0
          WHEN vm.tipo_periodo = 'anual' THEN 1
          ELSE 2
        END,
        vm.fecha ASC,
        vm.id ASC
      LIMIT 1
    `,
    [userId, fechaMes, year]
  );

  const selected = mapMetaRow(rows[0]);
  if (!selected) {
    return {
      id: null,
      usuario_id: userId,
      usuario_nombre: '',
      usuario_email: '',
      usuario_area: '',
      usuario_codigo: '',
      fecha: null,
      tipo_periodo: null,
      meta_original: 0,
      meta_mes: 0,
      prorrateada: false,
      activo: false,
      observacion: '',
      created_at: null,
      updated_at: null,
    };
  }

  if (selected.tipo_periodo === 'anual') {
    return {
      ...selected,
      meta_mes: Math.round(selected.meta_original / 12),
      prorrateada: true,
    };
  }

  return {
    ...selected,
    meta_mes: selected.meta_original,
    prorrateada: false,
  };
}

async function obtenerMetasMensualesVendedor(...args) {
  const { client, options } = resolveOptionsArgs(args);
  const usuarioId = normalizeNumero(options.usuarioId ?? options.usuario_id ?? options, 0);
  const anio = normalizeNumero(options.anio ?? options.year, new Date().getFullYear());
  if (!usuarioId) {
    return Array.from({ length: 12 }, (_, index) => ({
      mes: index + 1,
      meta_original: 0,
      meta_mes: 0,
      tipo_periodo: null,
      prorrateada: false,
      fecha: null,
    }));
  }

  const rows = await queryRows(
    client,
    `
      SELECT
        id,
        usuario_id,
        fecha,
        YEAR(fecha) AS anio,
        MONTH(fecha) AS mes,
        tipo_periodo,
        meta,
        activo,
        observacion
      FROM vendedor_meta
      WHERE usuario_id = ?
        AND COALESCE(activo, 1) = 1
        AND YEAR(fecha) = ?
      ORDER BY
        CASE WHEN tipo_periodo = 'mensual' THEN 0 ELSE 1 END,
        mes ASC,
        fecha ASC,
        id ASC
    `,
    [usuarioId, anio]
  );

  const metasMensuales = new Map();
  const metasAnuales = rows.filter(row => normalizeTipoPeriodo(row.tipo_periodo) === 'anual');
  const metaAnual = metasAnuales[0] || null;

  if (metasAnuales.length > 1) {
    console.warn('[vendedorMeta] múltiples metas anuales activas para el mismo usuario y año', {
      usuarioId,
      anio,
      total: metasAnuales.length,
    });
  }

  for (const row of rows) {
    if (normalizeTipoPeriodo(row.tipo_periodo) !== 'mensual') continue;
    const mes = normalizeMesFromRow(row);
    const fecha = formatFecha(row.fecha);
    if (!Number.isFinite(mes) || mes < 1 || mes > 12) continue;

    metasMensuales.set(mes, {
      mes,
      meta_original: normalizeNumero(row.meta, 0),
      meta_mes: normalizeNumero(row.meta, 0),
      tipo_periodo: 'mensual',
      prorrateada: false,
      fecha,
    });
  }

  return Array.from({ length: 12 }, (_, index) => {
    const mes = index + 1;
    const mensual = metasMensuales.get(mes);
    if (mensual) {
      return mensual;
    }

    if (metaAnual) {
      const metaOriginal = normalizeNumero(metaAnual.meta, 0);
      return {
        mes,
        meta_original: metaOriginal,
        meta_mes: Math.round(metaOriginal / 12),
        tipo_periodo: 'anual',
        prorrateada: true,
        fecha: formatFecha(metaAnual.fecha),
      };
    }

    return {
      mes,
      meta_original: 0,
      meta_mes: 0,
      tipo_periodo: null,
      prorrateada: false,
      fecha: null,
    };
  });
}

async function obtenerMetaPorId(...args) {
  const { client, options } = resolveOptionsArgs(args);
  const metaId = normalizeNumero(options.id ?? options.metaId ?? options, 0);
  if (!metaId) return null;

  const rows = await queryRows(
    client,
    `
      SELECT
        vm.id,
        vm.usuario_id,
        vm.fecha,
        vm.tipo_periodo,
        vm.meta,
        vm.activo,
        vm.observacion,
        vm.created_at,
        vm.updated_at,
        u.nombre AS usuario_nombre,
        u.email AS usuario_email,
        u.area AS usuario_area,
        u.codigo AS usuario_codigo
      FROM vendedor_meta vm
      LEFT JOIN usuario u ON u.id = vm.usuario_id
      WHERE vm.id = ?
      LIMIT 1
    `,
    [metaId]
  );

  return mapMetaRow(rows[0]) || null;
}

async function guardarMetaVendedor(...args) {
  const { client, options } = resolveOptionsArgs(args);
  const {
    id = null,
    usuario_id: usuarioId,
    anio,
    mes,
    tipo_periodo: tipoPeriodo,
    meta,
    activo = true,
    observacion = '',
  } = options;

  const userId = normalizeNumero(usuarioId, 0);
  const year = normalizeNumero(anio, 0);
  const tipo = normalizeTipoPeriodo(tipoPeriodo);
  const metaValue = normalizeNumero(meta, NaN);
  const mesValue = normalizeNumero(mes, NaN);

  if (!userId) {
    throw Object.assign(new Error('Debes seleccionar un usuario.'), { code: 'USUARIO_REQUERIDO', status: 400 });
  }
  if (!year) {
    throw Object.assign(new Error('Debes indicar un año válido.'), { code: 'ANIO_INVALIDO', status: 400 });
  }
  if (!tipo) {
    throw Object.assign(new Error('Debes indicar si la meta es mensual o anual.'), { code: 'TIPO_PERIODO_INVALIDO', status: 400 });
  }
  if (!Number.isFinite(metaValue) || metaValue < 0) {
    throw Object.assign(new Error('La meta debe ser un número igual o mayor a cero.'), { code: 'META_INVALIDA', status: 400 });
  }
  if (tipo === 'mensual' && (!Number.isFinite(mesValue) || mesValue < 1 || mesValue > 12)) {
    throw Object.assign(new Error('La meta mensual requiere un mes válido.'), { code: 'MES_INVALIDO', status: 400 });
  }

  const fecha = buildFechaPeriodo(tipo, year, Number.isFinite(mesValue) ? mesValue : 1);
  const estado = normalizeNumero(activo, 1) ? 1 : 0;
  const nota = normalizeText(observacion);

  if (id) {
    await client.query(
      `
        UPDATE vendedor_meta
        SET usuario_id = ?, fecha = ?, tipo_periodo = ?, meta = ?, activo = ?, observacion = ?, updated_at = NOW()
        WHERE id = ?
      `,
      [userId, fecha, tipo, metaValue, estado, nota || null, normalizeNumero(id)]
    );
    return obtenerMetaPorId(client, { id });
  }

  await client.query(
    `
      INSERT INTO vendedor_meta
        (usuario_id, fecha, tipo_periodo, meta, activo, observacion, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        meta = VALUES(meta),
        activo = VALUES(activo),
        observacion = VALUES(observacion),
        updated_at = NOW()
    `,
    [userId, fecha, tipo, metaValue, estado, nota || null]
  );

  return obtenerMetaVendedor(client, userId, year, tipo === 'mensual' ? Number(fecha.slice(5, 7)) : 1);
}

async function actualizarEstadoMetaVendedor(...args) {
  const { client, options } = resolveOptionsArgs(args);
  const metaId = normalizeNumero(options.id ?? options.metaId ?? options, 0);
  const activo = normalizeNumero(options.activo, 1) ? 1 : 0;
  if (!metaId) {
    throw Object.assign(new Error('Debes indicar una meta válida.'), { code: 'META_INVALIDA', status: 400 });
  }

  await client.query(
    'UPDATE vendedor_meta SET activo = ?, updated_at = NOW() WHERE id = ?',
    [activo, metaId]
  );

  return obtenerMetaPorId(client, { id: metaId });
}

module.exports = {
  obtenerMetaVendedor,
  obtenerMetasMensualesVendedor,
  listarMetasVendedor,
  obtenerMetaPorId,
  guardarMetaVendedor,
  actualizarEstadoMetaVendedor,
  normalizeTipoPeriodo,
  buildFechaPeriodo,
};
