'use strict';

/**
 * routes/dashboard.ajustes.js
 *
 * Ajustes de negocio para ventas compartidas.
 *
 * Regla:
 *   - Si un folio se comparte al X%, el vendedor receptor suma X%.
 *   - El vendedor original/coordinador suma solamente 100 - X%.
 *
 * Esto evita que el folio compartido se contabilice como 100% para el origen
 * y X% adicional para el receptor.
 */

const express = require('express');
const router = express.Router();

const db = require('../config/db');
const { getSoftlandPool } = require('../config/db.softland');
const { requireAuth } = require('../middlewares/requireAuth');
const { validarMesAnio } = require('../utils/stringHelpers');
const { getFactorHistorico } = require('../utils/precioHistorico');

router.use(requireAuth);

function getCodigos(usuario) {
  return (usuario?.vendedores || []).map(v => v.cod_vendedor).filter(Boolean);
}

function mssqlInStrings(arr) {
  return arr.map(v => `'${String(v).replace(/'/g, "''")}'`).join(',');
}

function mssqlInNums(arr) {
  return arr.map(n => Number(n)).filter(Number.isFinite).join(',');
}

function uniqueNums(arr) {
  return [...new Set(arr.map(Number).filter(Number.isFinite))];
}

function periodoDesdeReq(req) {
  const hoy = new Date();
  return validarMesAnio(
    req.query.mes ?? (hoy.getMonth() + 1),
    req.query.anio ?? hoy.getFullYear()
  );
}

async function getCompartidosPeriodo(codigos, mes, anio) {
  if (!codigos.length) return [];
  const inSql = codigos.map(() => '?').join(',');
  const [rows] = await db.pool.query(
    `SELECT id, folio, porcentaje, cod_vendedor_principal, cod_vendedor_compartido, mes, anio
       FROM factura_compartida
      WHERE rol = 'compartido'
        AND mes = ?
        AND anio = ?
        AND (
          cod_vendedor_principal IN (${inSql})
          OR cod_vendedor_compartido IN (${inSql})
        )`,
    [mes, anio, ...codigos, ...codigos]
  );
  return rows.map(r => ({
    ...r,
    folio: Number(r.folio),
    porcentaje: Number(r.porcentaje),
  }));
}

async function getCompartidosAnio(codigos, anio) {
  if (!codigos.length) return [];
  const inSql = codigos.map(() => '?').join(',');
  const [rows] = await db.pool.query(
    `SELECT id, folio, porcentaje, cod_vendedor_principal, cod_vendedor_compartido, mes, anio
       FROM factura_compartida
      WHERE rol = 'compartido'
        AND anio = ?
        AND (
          cod_vendedor_principal IN (${inSql})
          OR cod_vendedor_compartido IN (${inSql})
        )`,
    [anio, ...codigos, ...codigos]
  );
  return rows.map(r => ({
    ...r,
    folio: Number(r.folio),
    mes: Number(r.mes),
    porcentaje: Number(r.porcentaje),
  }));
}

function calcularParticipaciones(compartidos, codigos) {
  const setCodigos = new Set(codigos.map(String));
  const participaciones = [];

  for (const row of compartidos) {
    const pctAsignado = Math.max(0, Math.min(100, Number(row.porcentaje) || 0));
    const pctOrigen = Math.max(0, 100 - pctAsignado);

    if (setCodigos.has(String(row.cod_vendedor_principal)) && pctOrigen > 0) {
      participaciones.push({
        ...row,
        cod_vendedor_calculo: row.cod_vendedor_principal,
        porcentaje_calculo: pctOrigen,
        rol_calculo: 'origen',
      });
    }

    if (setCodigos.has(String(row.cod_vendedor_compartido)) && pctAsignado > 0) {
      participaciones.push({
        ...row,
        cod_vendedor_calculo: row.cod_vendedor_compartido,
        porcentaje_calculo: pctAsignado,
        rol_calculo: 'receptor',
      });
    }
  }

  return participaciones;
}

async function getTotalesFolios(folios, extraSelect = '') {
  const nums = uniqueNums(folios);
  if (!nums.length) return [];

  const pool = await getSoftlandPool();
  const result = await pool.request().query(`
    SELECT
      h.Folio,
      MIN(h.Fecha) AS Fecha,
      MONTH(MIN(h.Fecha)) AS mes,
      YEAR(MIN(h.Fecha)) AS anio,
      MIN(h.CodVendedor) AS CodVendedor,
      MIN(h.Tipo) AS Tipo,
      MIN(c.NomAux) AS cliente,
      ROUND(SUM(m.TotLinea), 0) AS monto,
      ROUND(SUM(
        CASE
          WHEN h.Tipo = 'N' AND m.CodProd LIKE 'NC%'
            THEN ISNULL(m.TotLinea, 0)
          WHEN cl.CodCan = '301'
            THEN ISNULL(m.CantFacturada, 0) * ISNULL(t.PrecioVta, 0) * 1.10
          ELSE ISNULL(m.CantFacturada, 0) * ISNULL(t.PrecioVta, 0)
        END
      ), 0) AS TotLineaReal
      ${extraSelect}
    FROM [PRODIN].[softland].[iw_gsaen] h
    INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = h.NroInt AND m.Tipo = h.Tipo
    LEFT JOIN [PRODIN].[softland].[iw_tprod] t ON t.CodProd = m.CodProd
    LEFT JOIN [PRODIN].[softland].[cwtcvcl] cl ON cl.CodAux = h.CodAux
    LEFT JOIN [PRODIN].[softland].[cwtauxi] c ON c.CodAux = h.CodAux
    WHERE h.Folio IN (${mssqlInNums(nums)})
      AND h.Tipo IN ('F','N','D')
      AND h.Estado <> 'A'
    GROUP BY h.Folio
  `);

  return result.recordset;
}

function calcularPctDescuento(montoCobrado, montoLista) {
  const cobrado = Number(montoCobrado || 0);
  const lista = Number(montoLista || 0);
  if (!Number.isFinite(cobrado) || !Number.isFinite(lista) || lista <= 0) return 0;
  const pct = (1 - (cobrado / lista)) * 100;
  return Math.max(0, Math.round(pct * 100) / 100);
}

router.get('/resumen', async (req, res) => {
  const codigos = getCodigos(req.usuario);
  let mes, anio;
  try { ({ mes, anio } = periodoDesdeReq(req)); }
  catch (err) { return res.status(400).json({ ok: false, error: err.message }); }

  try {
    const [metaRows] = await db.pool.query(
      `SELECT meta FROM vendedor_meta WHERE usuario_id = ? AND YEAR(fecha) = ? LIMIT 1`,
      [req.usuario.sub, anio]
    );
    const metaMes = metaRows.length ? Number(metaRows[0].meta) : 0;

    if (!codigos.length) {
      return res.json({ ok: true, totalVentas: 0, meta: metaMes, progreso: 0, pctDescuentoGlobal: 0 });
    }

    const compartidos = await getCompartidosPeriodo(codigos, mes, anio);
    const foliosCompartidos = uniqueNums(compartidos.map(r => r.folio));
    const exclude = foliosCompartidos.length ? `AND h.Folio NOT IN (${mssqlInNums(foliosCompartidos)})` : '';

    const pool = await getSoftlandPool();
    const propias = await pool.request().query(`
      SELECT
        ROUND(SUM(m.TotLinea), 0) AS totalVentas,
        ROUND(SUM(
          CASE
            WHEN h.Tipo = 'N' AND m.CodProd LIKE 'NC%'
              THEN ISNULL(m.TotLinea, 0)
            WHEN cl.CodCan = '301'
              THEN ISNULL(m.CantFacturada, 0) * ISNULL(t.PrecioVta, 0) * 1.10
            ELSE ISNULL(m.CantFacturada, 0) * ISNULL(t.PrecioVta, 0)
          END
        ), 0) AS totalLista
      FROM [PRODIN].[softland].[iw_gsaen] h
      INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = h.NroInt AND m.Tipo = h.Tipo
      LEFT JOIN [PRODIN].[softland].[iw_tprod] t ON t.CodProd = m.CodProd
      LEFT JOIN [PRODIN].[softland].[cwtcvcl] cl ON cl.CodAux = h.CodAux
      WHERE h.CodVendedor IN (${mssqlInStrings(codigos)})
        ${exclude}
        AND MONTH(h.Fecha) = ${mes}
        AND YEAR(h.Fecha) = ${anio}
        AND h.Tipo IN ('F','N','D')
        AND h.Estado <> 'A'
    `);

    let totalVentas = Number(propias.recordset[0]?.totalVentas) || 0;
    let totalLista = Number(propias.recordset[0]?.totalLista) || 0;

    const totalesCompartidos = await getTotalesFolios(foliosCompartidos);
    const porFolio = new Map(totalesCompartidos.map(r => [Number(r.Folio), r]));
    const participaciones = calcularParticipaciones(compartidos, codigos);

    for (const p of participaciones) {
      const base = porFolio.get(Number(p.folio));
      if (!base) continue;
      totalVentas += Math.round(Number(base.monto || 0) * p.porcentaje_calculo / 100);
      totalLista += Math.round(Number(base.TotLineaReal || 0) * p.porcentaje_calculo / 100);
    }

    const pctDescuentoGlobal = totalLista > 0
      ? Math.round((1 - totalVentas / totalLista) * 10000) / 100
      : 0;
    const progreso = metaMes > 0 ? Math.min(Math.round((totalVentas / metaMes) * 100), 999) : 0;

    res.json({ ok: true, totalVentas: Math.round(totalVentas), meta: metaMes, progreso, pctDescuentoGlobal });
  } catch (err) {
    console.error('[GET /api/dashboard/resumen ajuste]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener resumen ajustado' });
  }
});

router.get('/evolucion', async (req, res) => {
  const codigos = getCodigos(req.usuario);
  const hoy = new Date();
  let anio;
  try { ({ anio } = validarMesAnio(1, req.query.anio ?? hoy.getFullYear())); }
  catch (err) { return res.status(400).json({ ok: false, error: err.message }); }

  try {
    const [metaRows] = await db.pool.query(
      `SELECT meta FROM vendedor_meta WHERE usuario_id = ? AND YEAR(fecha) = ? LIMIT 1`,
      [req.usuario.sub, anio]
    );
    const metaMes = metaRows.length ? Number(metaRows[0].meta) : 0;

    if (!codigos.length) {
      return res.json({ ok: true, evolucion: Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, ventas: 0, meta: metaMes })) });
    }

    const compartidos = await getCompartidosAnio(codigos, anio);
    const foliosCompartidos = uniqueNums(compartidos.map(r => r.folio));
    const exclude = foliosCompartidos.length ? `AND h.Folio NOT IN (${mssqlInNums(foliosCompartidos)})` : '';

    const pool = await getSoftlandPool();
    const propias = await pool.request().query(`
      SELECT MONTH(h.Fecha) AS mes, ROUND(SUM(m.TotLinea), 0) AS ventas
      FROM [PRODIN].[softland].[iw_gsaen] h
      INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = h.NroInt AND m.Tipo = h.Tipo
      WHERE h.CodVendedor IN (${mssqlInStrings(codigos)})
        ${exclude}
        AND YEAR(h.Fecha) = ${anio}
        AND h.Tipo IN ('F','N','D')
        AND h.Estado <> 'A'
      GROUP BY MONTH(h.Fecha)
    `);

    const ventasPorMes = {};
    for (const row of propias.recordset) ventasPorMes[Number(row.mes)] = Number(row.ventas) || 0;

    const totalesCompartidos = await getTotalesFolios(foliosCompartidos);
    const porFolio = new Map(totalesCompartidos.map(r => [Number(r.Folio), r]));
    const participaciones = calcularParticipaciones(compartidos, codigos);

    for (const p of participaciones) {
      const base = porFolio.get(Number(p.folio));
      if (!base) continue;
      const mesFolio = Number(p.mes || base.mes);
      ventasPorMes[mesFolio] = (ventasPorMes[mesFolio] || 0)
        + Math.round(Number(base.monto || 0) * p.porcentaje_calculo / 100);
    }

    res.json({
      ok: true,
      evolucion: Array.from({ length: 12 }, (_, i) => ({
        mes: i + 1,
        ventas: Math.round(ventasPorMes[i + 1] || 0),
        meta: metaMes,
      })),
    });
  } catch (err) {
    console.error('[GET /api/dashboard/evolucion ajuste]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener evolución ajustada' });
  }
});

router.get('/ventas-mes', async (req, res) => {
  const codigos = getCodigos(req.usuario);
  let mes, anio;
  try { ({ mes, anio } = periodoDesdeReq(req)); }
  catch (err) { return res.status(400).json({ ok: false, error: err.message }); }

  try {
    if (!codigos.length) return res.json({ ok: true, ventas: [] });

    const factor = await getFactorHistorico(mes, anio);
    const compartidos = await getCompartidosPeriodo(codigos, mes, anio);
    const foliosCompartidos = uniqueNums(compartidos.map(r => r.folio));
    const exclude = foliosCompartidos.length ? `AND h.Folio NOT IN (${mssqlInNums(foliosCompartidos)})` : '';

    const pool = await getSoftlandPool();
    const propias = await pool.request().query(`
      SELECT
        h.Folio,
        CONVERT(VARCHAR(10), h.Fecha, 103) AS fecha_formato,
        MIN(c.NomAux) AS cliente,
        h.CodVendedor,
        h.Tipo,
        ROUND(SUM(m.TotLinea), 0) AS monto,
        ROUND(SUM(m.TotLinea), 0) AS venta_real_folio,
        ROUND(SUM(
          CASE
            WHEN h.Tipo = 'N' AND m.CodProd LIKE 'NC%'
              THEN ISNULL(m.TotLinea, 0)
            WHEN cl.CodCan = '301'
              THEN ISNULL(m.CantFacturada, 0) * ISNULL(t.PrecioVta, 0) * 1.10
            ELSE ISNULL(m.CantFacturada, 0) * ISNULL(t.PrecioVta, 0)
          END
        ), 0) AS TotLineaReal,
        0 AS pct_descuento,
        0 AS es_compartido
      FROM [PRODIN].[softland].[iw_gsaen] h
      INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = h.NroInt AND m.Tipo = h.Tipo
      LEFT JOIN [PRODIN].[softland].[iw_tprod] t ON t.CodProd = m.CodProd
      LEFT JOIN [PRODIN].[softland].[cwtcvcl] cl ON cl.CodAux = h.CodAux
      LEFT JOIN [PRODIN].[softland].[cwtauxi] c ON c.CodAux = h.CodAux
      WHERE h.CodVendedor IN (${mssqlInStrings(codigos)})
        ${exclude}
        AND MONTH(h.Fecha) = ${mes}
        AND YEAR(h.Fecha) = ${anio}
        AND h.Tipo IN ('F','N','D')
        AND h.Estado <> 'A'
      GROUP BY h.Folio, h.Fecha, h.CodVendedor, h.Tipo
      ORDER BY h.Fecha DESC, h.Folio
    `);

    const ventas = propias.recordset.map(v => ({
      ...v,
      monto: Math.round(Number(v.monto || 0) * factor),
      venta_real_folio: Math.round(Number(v.venta_real_folio || 0)),
      TotLineaReal: Math.round(Number(v.TotLineaReal || 0)),
    }));

    ventas.forEach(v => {
      v.pct_descuento = calcularPctDescuento(v.monto, v.TotLineaReal);
    });

    const totalesCompartidos = await getTotalesFolios(foliosCompartidos);
    const porFolio = new Map(totalesCompartidos.map(r => [Number(r.Folio), r]));
    const participaciones = calcularParticipaciones(compartidos, codigos);

    for (const p of participaciones) {
      const base = porFolio.get(Number(p.folio));
      if (!base) continue;
      const montoBase = Math.round(Number(base.monto || 0) * factor);
      const montoAsignado = Math.round(montoBase * p.porcentaje_calculo / 100);
      const listaAsignada = Math.round(Number(base.TotLineaReal || 0) * p.porcentaje_calculo / 100);

      ventas.push({
        Folio: base.Folio,
        fecha_formato: base.Fecha ? new Date(base.Fecha).toLocaleDateString('es-CL') : '',
        cliente: base.cliente || '',
        CodVendedor: base.CodVendedor || p.cod_vendedor_principal,
        Tipo: base.Tipo || 'F',
        monto: montoAsignado,
        venta_real_folio: Math.round(Number(base.monto || 0)),
        TotLineaReal: listaAsignada,
        pct_descuento: 0,
        es_compartido: true,
        monto_asignado: montoAsignado,
        porcentaje_asignado: p.porcentaje_calculo,
        rol_participacion: p.rol_calculo,
        cod_vendedor_principal: p.cod_vendedor_principal,
        cod_vendedor_compartido: p.cod_vendedor_compartido,
      });
      ventas[ventas.length - 1].pct_descuento = calcularPctDescuento(montoAsignado, listaAsignada);
    }

    ventas.sort((a, b) => Number(b.Folio) - Number(a.Folio));
    res.json({ ok: true, ventas, factor });
  } catch (err) {
    console.error('[GET /api/dashboard/ventas-mes ajuste]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener ventas del mes ajustadas' });
  }
});

module.exports = router;
