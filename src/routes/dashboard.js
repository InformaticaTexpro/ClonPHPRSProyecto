'use strict';

/**
 * routes/dashboard.js
 *
 * API del dashboard principal de ventas.
 *
 * Responsabilidades:
 *   - Calcular KPIs de ventas/meta/progreso/descuento
 *   - Entregar evolución mensual
 *   - Administrar flujo de facturas compartidas (coordinadores)
 *   - Disparar notificaciones de meta cumplida/superada
 *
 * Origen de información:
 *   - MySQL: vendedor_meta, factura_compartida, usuario, usuario_vendedor
 *   - SQL Server Softland: documentos comerciales y detalle de líneas
 *
 * Seguridad:
 *   router.use(requireAuth) para requerir JWT en todos los endpoints.
 *   T-01: validateFolio, validateCodVendedor, validatePorcentaje aplicados
 *         en endpoints que reciben parámetros de req.params / req.body.
 *
 * FIX 2026-04-23:
 *   /vendedores — INNER JOIN iw_tprod reemplazado por LEFT JOIN.
 *   ISNULL() protege los cálculos de PrecioVta cuando el JOIN no matchea.
 *
 * FIX 2026-04-27 (a):
 *   /ventas-mes — descuento ponderado real: (1 - SUM(TotLinea)/SUM(base_lista)) × 100
 *
 * FIX 2026-04-27 (b) — Opción A:
 *   /vendedores — compartidos recibidos aparecen como FILA EXTRA con el
 *   cod_vendedor_principal (Norelbys, Sergio, Nadia…) y el monto asignado.
 *
 * FEAT 2026-04-29 (a):
 *   /detalle/:folio — divisor_historico hardcodeado reemplazado por
 *   getFactorHistorico(mes, anio) que lee tasas_descuentos en MySQL.
 *
 * FIX 2026-04-29 (b):
 *   /detalle/:folio — base del cálculo histórico corregida.
 *   Anterior: se usaba PrecioVta (precio lista vigente de Softland).
 *   Correcto: se parte del precio unitario REAL cobrado (TotLinea / CantFacturada)
 *   y se aplica el factor histórico sobre él.
 *
 *   Fórmula correcta por línea:
 *     precio_unitario_cobrado   = TotLinea / CantFacturada
 *     precio_unitario_historico = precio_unitario_cobrado * factor
 *     valor_historico_linea     = precio_unitario_historico * CantFacturada
 *
 *   PrecioVta se mantiene en el response solo como dato informativo
 *   (precio lista actual de Softland), pero NO interviene en el cálculo.
 *
 * FIX 2026-06-09:
 *   /clientes-resumen — TotalClientesHist cambiado de cwtauxven a iw_gsaen
 *   (sin filtro de período). cwtauxven contaba clientes asignados
 *   formalmente (número fijo), no clientes con documentos reales.
 *   Ahora ambas columnas provienen de la misma fuente y son comparables.
 *
 * FIX 2026-06-17 (a):
 *   getFoliosYaAsignados — eliminado filtro mes/anio.
 *   Un folio asignado en cualquier período debe quedar excluido del selector
 *   sin importar el mes que se esté visualizando. Antes, un folio de abril
 *   registrado en factura_compartida no era detectado al consultar junio,
 *   haciendo que apareciera disponible cuando ya estaba asignado.
 *
 * FIX 2026-06-17 (b):
 *   /asignados — eliminado filtro mes/anio.
 *   El INSERT guarda el mes real del folio en Softland (ej. mes=4 para abril).
 *   Si el panel estaba en marzo (mes=3) y se asignaba un folio de abril,
 *   el registro quedaba con mes=4 y luego no aparecía en marzo ni en ningún
 *   mes hasta que el coordinador cambiara al panel de abril. Ahora /asignados
 *   devuelve todos los folios asignados por el coordinador sin filtro de período.
 */

const express             = require('express');
const router              = express.Router();
const { requireAuth }     = require('../middlewares/requireAuth');
const db                  = require('../config/db');
const { getSoftlandPool } = require('../config/db.softland');
const notificacionModel   = require('../models/notificacion');
const {
  validateFolio,
  validateCodVendedor,
  validatePorcentaje,
  validateId,
} = require('../utils/validators');
const { getFactorHistorico } = require('../utils/precioHistorico');

router.use(requireAuth);

// ── helpers ───────────────────────────────────────────────────────────────────

function getCodigos(usuario) {
  return (usuario.vendedores || []).map(v => v.cod_vendedor);
}

function getCodigosCoordinador(usuario) {
  return (usuario.vendedores || [])
    .filter(v => v.tipo === 'C')
    .map(v => v.cod_vendedor);
}

function mssqlIn(arr) {
  return arr.map(v => `'${v}'`).join(',');
}

function sqlPrecioListaUnitarioReal({ factorExpr = null } = {}) {
  const factor = factorExpr ? ` * (${factorExpr})` : '';
  return `
    CASE
      WHEN h.Tipo = 'N' AND m.CodProd LIKE 'NC%'
        THEN ISNULL(m.TotLinea / NULLIF(m.CantFacturada, 0), 0)${factor}
      WHEN ISNULL(m.CantFacturada, 0) <= 0
        THEN 0
      WHEN cl.CodCan = '301'
        THEN ISNULL(t.PrecioVta, 0) * 1.10${factor}
      ELSE ISNULL(t.PrecioVta, 0)${factor}
    END
  `;
}

function sqlBaseListaRealTotal({ factorExpr = null } = {}) {
  return `(${sqlPrecioListaUnitarioReal({ factorExpr })}) * ISNULL(m.CantFacturada, 0)`;
}

async function getFoliosCompartidosConPct(codigos, mes, anio) {
  if (!codigos.length) return [];
  const placeholders = codigos.map(() => '?').join(',');
  const [rows] = await db.pool.query(
    `SELECT folio, porcentaje, cod_vendedor_principal
     FROM factura_compartida
     WHERE cod_vendedor_compartido IN (${placeholders})
       AND mes  = ?
       AND anio = ?
       AND rol  = 'compartido'`,
    [...codigos, mes, anio]
  );
  return rows.map(r => ({
    folio:                Number(r.folio),
    porcentaje:           Number(r.porcentaje),
    cod_vendedor_principal: r.cod_vendedor_principal,
  }));
}

/**
 * Devuelve los folios que ya tienen una fila en factura_compartida
 * para cualquiera de los coordinadores indicados, sin importar el
 * mes/año en que fueron registrados.
 *
 * FIX 2026-06-17 (a): se eliminó el filtro mes/anio que provocaba que
 * folios de meses anteriores (ej. abril) no fueran detectados al
 * consultar el panel de junio y siguieran apareciendo como disponibles.
 */
async function getFoliosYaAsignados(codigosCoord) {
  if (!codigosCoord.length) return [];
  const placeholders = codigosCoord.map(() => '?').join(',');
  const [rows] = await db.pool.query(
    `SELECT DISTINCT folio
     FROM factura_compartida
     WHERE cod_vendedor_principal IN (${placeholders})
       AND rol = 'compartido'`,
    [...codigosCoord]
  );
  return rows.map(r => Number(r.folio));
}

async function getNombreVendedor(codVendedor) {
  try {
    const [rows] = await db.pool.query(
      `SELECT u.nombre FROM usuario_vendedor uv
       INNER JOIN usuario u ON u.id = uv.usuario_id
       WHERE uv.cod_vendedor = ? LIMIT 1`,
      [codVendedor]
    );
    return rows.length ? rows[0].nombre : codVendedor;
  } catch { return codVendedor; }
}

// ── GET /api/dashboard/resumen ─────────────────────────────────────────
router.get('/resumen', async (req, res) => {
  const usuario = req.usuario;
  const codigos = getCodigos(usuario);
  const hoy  = new Date();
  const { validarMesAnio } = require('../utils/stringHelpers');
  let mes, anio;
  try {
    ({ mes, anio } = validarMesAnio(req.query.mes ?? (hoy.getMonth() + 1), req.query.anio ?? hoy.getFullYear()));
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }

  try {
    const [metaRows] = await db.pool.query(
      `SELECT meta FROM vendedor_meta WHERE usuario_id = ? AND YEAR(fecha) = ? LIMIT 1`,
      [usuario.sub, anio]
    );
    const metaMes = metaRows.length ? Number(metaRows[0].meta) : 0;

    if (!codigos.length) {
      return res.json({ ok: true, totalVentas: 0, meta: metaMes, progreso: 0, pctDescuentoGlobal: 0 });
    }

    const foliosCompPct  = await getFoliosCompartidosConPct(codigos, mes, anio);
    const foliosCompNums = foliosCompPct.map(r => r.folio);
    const pool = await getSoftlandPool();

    const excludeComp = foliosCompNums.length ? `AND h.Folio NOT IN (${foliosCompNums.join(',')})` : '';
    const resultPropias = await pool.request().query(`
      SELECT SUM(m.TotLinea) AS totalVentas
      FROM [PRODIN].[softland].[iw_gsaen] h
      INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = h.NroInt AND m.Tipo = h.Tipo
      WHERE h.CodVendedor IN (${mssqlIn(codigos)})
        ${excludeComp}
        AND MONTH(h.Fecha) = ${mes} AND YEAR(h.Fecha) = ${anio}
        AND h.Tipo IN ('F','N','D') AND h.Estado <> 'A'
    `);

    let totalVentas = Number(resultPropias.recordset[0]?.totalVentas) || 0;

    if (foliosCompPct.length) {
      const resultComp = await pool.request().query(`
        SELECT h.Folio, SUM(m.TotLinea) AS totalLinea
        FROM [PRODIN].[softland].[iw_gsaen] h
        INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = h.NroInt AND m.Tipo = h.Tipo
        WHERE h.Folio IN (${foliosCompNums.join(',')})
          AND h.Tipo IN ('F','N','D') AND h.Estado <> 'A'
        GROUP BY h.Folio
      `);
      for (const row of resultComp.recordset) {
        const pctInfo = foliosCompPct.find(r => r.folio === Number(row.Folio));
        if (pctInfo) totalVentas += Math.round(Number(row.totalLinea) * pctInfo.porcentaje / 100);
      }
    }

    const resultDesc = await pool.request().query(`
      WITH FoliosCompartidos AS (
        SELECT
          h.Folio,
          CASE WHEN COUNT(DISTINCT h.CodVendedor) > 1 THEN 1 ELSE 0 END AS EsCompartido
        FROM [PRODIN].[softland].[iw_gsaen] h
        WHERE MONTH(h.Fecha) = ${mes} AND YEAR(h.Fecha) = ${anio}
          AND h.Tipo IN ('F','N','D') AND h.Estado <> 'A'
        GROUP BY h.Folio
      ),
      DetalleVentas AS (
        SELECT
          ROUND(SUM(m.TotLinea), 0) AS venta_real_folio,
          ROUND(SUM(
            CASE
              WHEN h.Tipo = 'N' AND m.CodProd LIKE 'NC%'
                THEN ISNULL(m.TotLinea, 0)
              WHEN cl.CodCan = '301'
                THEN ISNULL(m.CantFacturada, 0) * ISNULL(t.PrecioVta, 0) * 1.10
              ELSE ISNULL(m.CantFacturada, 0) * ISNULL(t.PrecioVta, 0)
            END
          ), 0) AS TotLineaReal
        FROM [PRODIN].[softland].[iw_gsaen] h
        LEFT JOIN [PRODIN].[softland].[cwtauxi]  c  ON c.CodAux  = h.CodAux
        LEFT JOIN [PRODIN].[softland].[cwtcvcl]  cl ON cl.CodAux = h.CodAux
        LEFT JOIN [PRODIN].[softland].[iw_gmovi] m  ON m.NroInt  = h.NroInt AND m.Tipo = h.Tipo
        LEFT JOIN [PRODIN].[softland].[iw_tprod] t  ON t.CodProd = m.CodProd
        LEFT JOIN FoliosCompartidos              fc ON fc.Folio   = h.Folio
        WHERE h.CodVendedor IN (${mssqlIn(codigos)})
          AND MONTH(h.Fecha) = ${mes} AND YEAR(h.Fecha) = ${anio}
          AND h.Tipo IN ('F','N','D') AND h.Estado <> 'A'
        GROUP BY h.Folio, h.Fecha, h.Tipo, h.CodVendedor, h.NroInt, fc.EsCompartido
      )
      SELECT ROUND(
        CASE
          WHEN SUM(TotLineaReal) > 0
            THEN (1 - (SUM(venta_real_folio) / NULLIF(SUM(TotLineaReal), 0))) * 100
          ELSE 0
        END
      , 2) AS pctDescuentoGlobal
      FROM DetalleVentas
    `);

    const pctDescuentoGlobal = Number(resultDesc.recordset[0]?.pctDescuentoGlobal) || 0;
    const progreso = metaMes > 0 ? Math.min(Math.round((totalVentas / metaMes) * 100), 999) : 0;

    const mesActual = hoy.getMonth() + 1, anioActual = hoy.getFullYear();
    if (mes === mesActual && anio === anioActual && metaMes > 0) {
      if (progreso >= 110) notificacionModel.notificarMetaSuperada({ usuarioId: usuario.sub, mes, anio, progreso }).catch(e => console.error('[notif]', e.message));
      else if (progreso >= 100) notificacionModel.notificarMetaCumplida({ usuarioId: usuario.sub, mes, anio }).catch(e => console.error('[notif]', e.message));
    }

    res.json({ ok: true, totalVentas, meta: metaMes, progreso, pctDescuentoGlobal });
  } catch (err) {
    console.error('[GET /api/dashboard/resumen]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener resumen' });
  }
});

// ── GET /api/dashboard/evolucion ────────────────────────────────────────
router.get('/evolucion', async (req, res) => {
  const usuario = req.usuario;
  const codigos = getCodigos(usuario);
  const hoy  = new Date();
  const { validarMesAnio } = require('../utils/stringHelpers');
  let anio;
  try {
    ({ anio } = validarMesAnio(1, req.query.anio ?? hoy.getFullYear()));
  } catch (err) { return res.status(400).json({ ok: false, error: err.message }); }

  try {
    const [metaRows] = await db.pool.query(
      `SELECT meta FROM vendedor_meta WHERE usuario_id=? AND YEAR(fecha)=? LIMIT 1`,
      [usuario.sub, anio]
    );
    const metaMes = metaRows.length ? Number(metaRows[0].meta) : 0;
    if (!codigos.length) {
      return res.json({ ok: true, evolucion: Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, ventas: 0, meta: metaMes })) });
    }

    const placeholders = codigos.map(() => '?').join(',');
    const [compRows] = await db.pool.query(
      `SELECT folio, mes, porcentaje FROM factura_compartida
       WHERE cod_vendedor_compartido IN (${placeholders}) AND anio=? AND rol='compartido'`,
      [...codigos, anio]
    );
    const compPorMes = {};
    compRows.forEach(r => {
      const m = Number(r.mes);
      if (!compPorMes[m]) compPorMes[m] = [];
      compPorMes[m].push({ folio: Number(r.folio), porcentaje: Number(r.porcentaje) });
    });
    const todosLosCompFolios = [...new Set(compRows.map(r => Number(r.folio)))];
    const pool = await getSoftlandPool();
    const excludeComp = todosLosCompFolios.length ? `AND h.Folio NOT IN (${todosLosCompFolios.join(',')})` : '';

    const resultPropias = await pool.request().query(`
      SELECT MONTH(h.Fecha) AS mes, SUM(m.TotLinea) AS ventas
      FROM [PRODIN].[softland].[iw_gsaen] h
      INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = h.NroInt AND m.Tipo = h.Tipo
      WHERE h.CodVendedor IN (${mssqlIn(codigos)})
        AND YEAR(h.Fecha) = ${anio}
        AND h.Tipo IN ('F','N','D') AND h.Estado <> 'A'
        ${excludeComp}
      GROUP BY MONTH(h.Fecha)
      ORDER BY mes
    `);
    const ventasPorMes = {};
    resultPropias.recordset.forEach(r => { ventasPorMes[r.mes] = Number(r.ventas) || 0; });

    if (todosLosCompFolios.length) {
      const resultComp = await pool.request().query(`
        SELECT MONTH(h.Fecha) AS mes, h.Folio, SUM(m.TotLinea) AS totalLinea
        FROM [PRODIN].[softland].[iw_gsaen] h
        INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = h.NroInt AND m.Tipo = h.Tipo
        WHERE h.Folio IN (${todosLosCompFolios.join(',')})
          AND YEAR(h.Fecha) = ${anio}
          AND h.Tipo IN ('F','N','D') AND h.Estado <> 'A'
        GROUP BY MONTH(h.Fecha), h.Folio
      `);
      for (const row of resultComp.recordset) {
        const mesNum  = Number(row.mes);
        const pctInfo = (compPorMes[mesNum] || []).find(r => r.folio === Number(row.Folio));
        if (pctInfo) ventasPorMes[mesNum] = (ventasPorMes[mesNum] || 0) + Math.round(Number(row.totalLinea) * pctInfo.porcentaje / 100);
      }
    }

    res.json({ ok: true, evolucion: Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, ventas: ventasPorMes[i + 1] || 0, meta: metaMes })) });
  } catch (err) {
    console.error('[GET /api/dashboard/evolucion]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener evolución' });
  }
});

// ── GET /api/dashboard/vendedores ──────────────────────────────────────
router.get('/vendedores', async (req, res) => {
  const usuario = req.usuario, codigos = getCodigos(usuario), hoy = new Date();
  const { validarMesAnio } = require('../utils/stringHelpers');
  let mes, anio;
  try { ({ mes, anio } = validarMesAnio(req.query.mes ?? (hoy.getMonth() + 1), req.query.anio ?? hoy.getFullYear())); }
  catch (err) { return res.status(400).json({ ok: false, error: err.message }); }
  if (!codigos.length) return res.json({ ok: true, vendedores: [] });

  try {
    const foliosRecibidosConPct = await getFoliosCompartidosConPct(codigos, mes, anio);
    const foliosRecibidosNums   = foliosRecibidosConPct.map(r => r.folio);

    const [rowsPrincipal] = await db.pool.query(
      `SELECT folio, porcentaje, cod_vendedor_principal, cod_vendedor_compartido
       FROM factura_compartida
       WHERE cod_vendedor_principal IN (${codigos.map(() => '?').join(',')})
         AND mes = ? AND anio = ? AND rol = 'compartido'`,
      [...codigos, mes, anio]
    );
    const foliosCedidosNums = rowsPrincipal.map(r => Number(r.folio));

    const todosFoliosComp = [...new Set([...foliosRecibidosNums, ...foliosCedidosNums])];
    const excludeComp     = todosFoliosComp.length
      ? `AND h.Folio NOT IN (${todosFoliosComp.join(',')})` : '';

    const pool = await getSoftlandPool();

    const resultPropias = await pool.request().query(`
      WITH FoliosCompartidos AS (
        SELECT
          h.Folio,
          CASE WHEN COUNT(DISTINCT h.CodVendedor) > 1 THEN 1 ELSE 0 END AS EsCompartido
        FROM [PRODIN].[softland].[iw_gsaen] h
        WHERE MONTH(h.Fecha) = ${mes}
          AND YEAR(h.Fecha)  = ${anio}
          AND h.Tipo IN ('F','N','D')
          AND h.Estado <> 'A'
        GROUP BY h.Folio
      )
      SELECT
        h.CodVendedor                                                             AS codVendedor,
        MIN(v.VenDes)                                                             AS nombreVendedor,
        COUNT(DISTINCT h.Folio)                                                   AS totalFolios,
        ROUND(SUM(m.TotLinea), 0)                                                 AS totalVentasCobrado,
        ROUND(SUM(
          CASE
            WHEN h.Tipo = 'N' AND m.CodProd LIKE 'NC%'
              THEN ISNULL(m.TotLinea, 0)
            WHEN cl.CodCan = '301'
              THEN ISNULL(m.CantFacturada, 0) * ISNULL(t.PrecioVta, 0) * 1.10
            ELSE ISNULL(m.CantFacturada, 0) * ISNULL(t.PrecioVta, 0)
          END
        ), 0)                                                                     AS ventaRealLista
      FROM [PRODIN].[softland].[iw_gsaen] h
      INNER JOIN [PRODIN].[softland].[iw_gmovi] m  ON m.NroInt  = h.NroInt AND m.Tipo = h.Tipo
      LEFT  JOIN [PRODIN].[softland].[iw_tprod] t  ON t.CodProd = m.CodProd
      LEFT  JOIN [PRODIN].[softland].[cwtcvcl]  cl ON cl.CodAux = h.CodAux
      LEFT  JOIN [PRODIN].[softland].[cwtvend]   v ON v.VenCod  = h.CodVendedor
      LEFT  JOIN FoliosCompartidos               fc ON fc.Folio  = h.Folio
      WHERE h.CodVendedor IN (${mssqlIn(codigos)})
        ${excludeComp}
        AND MONTH(h.Fecha) = ${mes} AND YEAR(h.Fecha) = ${anio}
        AND h.Tipo IN ('F','N','D') AND h.Estado <> 'A'
      GROUP BY h.CodVendedor
      ORDER BY h.CodVendedor
    `);

    const mapa = {};
    for (const cod of codigos) {
      mapa[cod] = { codVendedor: cod, nombreVendedor: cod, totalFolios: 0,
                   totalVentasCobrado: 0, ventaRealLista: 0, esCompartidoRecibido: false };
    }
    for (const row of resultPropias.recordset) {
      mapa[row.codVendedor] = {
        codVendedor:          row.codVendedor,
        nombreVendedor:       row.nombreVendedor || row.codVendedor,
        totalFolios:          Number(row.totalFolios),
        totalVentasCobrado:   Number(row.totalVentasCobrado) || 0,
        ventaRealLista:       Number(row.ventaRealLista)     || 0,
        esCompartidoRecibido: false,
      };
    }

    if (todosFoliosComp.length) {
      const resultComp = await pool.request().query(`
        SELECT
          h.Folio,
          h.CodVendedor                                            AS codVendedorSoftland,
          MIN(v.VenDes)                                            AS nombreVendedorSoftland,
          ROUND(SUM(m.TotLinea), 0)                                AS totalLinea,
          ROUND(SUM(
            CASE
              WHEN h.Tipo = 'N' AND m.CodProd LIKE 'NC%'
                THEN ISNULL(m.TotLinea, 0)
              WHEN cl.CodCan = '301'
                THEN ISNULL(m.CantFacturada, 0) * ISNULL(t.PrecioVta, 0) * 1.10
              ELSE ISNULL(m.CantFacturada, 0) * ISNULL(t.PrecioVta, 0)
            END
          ), 0)                                                    AS listaLinea
        FROM [PRODIN].[softland].[iw_gsaen] h
        INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = h.NroInt AND m.Tipo = h.Tipo
        LEFT  JOIN [PRODIN].[softland].[iw_tprod] t ON t.CodProd = m.CodProd
        LEFT  JOIN [PRODIN].[softland].[cwtcvcl] cl ON cl.CodAux = h.CodAux
        LEFT  JOIN [PRODIN].[softland].[cwtvend]  v ON v.VenCod  = h.CodVendedor
        WHERE h.Folio IN (${todosFoliosComp.join(',')})
          AND h.Tipo IN ('F','N','D') AND h.Estado <> 'A'
        GROUP BY h.Folio, h.CodVendedor
      `);

      for (const row of resultComp.recordset) {
        const folio     = Number(row.Folio);
        const montoReal = Number(row.totalLinea) || 0;
        const listaReal = Number(row.listaLinea) || 0;

        const infoPrincipal = rowsPrincipal.find(r => Number(r.folio) === folio);
        if (infoPrincipal && mapa[infoPrincipal.cod_vendedor_principal]) {
          const pctRetiene = 100 - Number(infoPrincipal.porcentaje);
          const acum = mapa[infoPrincipal.cod_vendedor_principal];
          acum.totalFolios        += 1;
          acum.totalVentasCobrado += Math.round(montoReal * pctRetiene / 100);
          acum.ventaRealLista     += Math.round(listaReal * pctRetiene / 100);
        }

        const infoRecibido = foliosRecibidosConPct.find(r => r.folio === folio);
        if (infoRecibido) {
          const codPrincipal    = infoRecibido.cod_vendedor_principal;
          const pctAsignado     = Number(infoRecibido.porcentaje);
          const nombrePrincipal = row.nombreVendedorSoftland || codPrincipal;

          if (!mapa[codPrincipal]) {
            mapa[codPrincipal] = {
              codVendedor:          codPrincipal,
              nombreVendedor:       nombrePrincipal,
              totalFolios:          0,
              totalVentasCobrado:   0,
              ventaRealLista:       0,
              esCompartidoRecibido: true,
            };
          }
          const acum = mapa[codPrincipal];
          acum.totalFolios        += 1;
          acum.totalVentasCobrado += Math.round(montoReal * pctAsignado / 100);
          acum.ventaRealLista     += Math.round(listaReal * pctAsignado / 100);
        }
      }
    }

    const vendedores = Object.values(mapa)
      .map(v => ({
        ...v,
        totalVentasCobrado: Math.round(v.totalVentasCobrado),
        ventaRealLista:     Math.round(v.ventaRealLista),
        pctDescuento: v.ventaRealLista > 0
          ? Math.round((1 - v.totalVentasCobrado / v.ventaRealLista) * 10000) / 100
          : 0,
      }))
      .filter(v => v.totalFolios > 0 || v.totalVentasCobrado > 0 || v.esCompartidoRecibido)
      .sort((a, b) => b.totalVentasCobrado - a.totalVentasCobrado);

    res.json({ ok: true, vendedores });
  } catch (err) {
    console.error('[GET /api/dashboard/vendedores]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener vendedores' });
  }
});

// ── GET /api/dashboard/vendedores-todos ───────────────────────────────
router.get('/vendedores-todos', async (req, res) => {
  try {
    const [rows] = await db.pool.query(`
      SELECT u.codigo AS cod, u.nombre AS nombre FROM usuario u
      INNER JOIN usuario_vendedor uv ON uv.usuario_id = u.id AND uv.cod_vendedor = u.codigo
      WHERE uv.tipo <> 'C' AND u.is_active = 1 ORDER BY u.nombre
    `);
    res.json({ ok: true, vendedores: rows });
  } catch (err) {
    console.error('[GET /api/dashboard/vendedores-todos]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener vendedores' });
  }
});

// ── GET /api/dashboard/ventas-mes ──────────────────────────────────────
router.get('/ventas-mes', async (req, res) => {
  const usuario = req.usuario, codigos = getCodigos(usuario), hoy = new Date();
  const { validarMesAnio } = require('../utils/stringHelpers');
  let mes, anio;
  try { ({ mes, anio } = validarMesAnio(req.query.mes ?? (hoy.getMonth() + 1), req.query.anio ?? hoy.getFullYear())); }
  catch (err) { return res.status(400).json({ ok: false, error: err.message }); }
  if (!codigos.length) return res.json({ ok: true, ventas: [] });
  try {
    const factor        = await getFactorHistorico(mes, anio);
    const foliosCompPct = await getFoliosCompartidosConPct(codigos, mes, anio);
    const foliosComp    = foliosCompPct.map(r => r.folio);
    const extraFolios   = foliosComp.length ? `OR h.Folio IN (${foliosComp.join(',')})` : '';
    const pool = await getSoftlandPool();
    const result = await pool.request().query(`
      WITH FoliosCompartidos AS (
        SELECT
          h.Folio,
          CASE WHEN COUNT(DISTINCT h.CodVendedor) > 1 THEN 1 ELSE 0 END AS EsCompartido
        FROM [PRODIN].[softland].[iw_gsaen] h
        WHERE MONTH(h.Fecha) = ${mes} AND YEAR(h.Fecha) = ${anio}
          AND h.Tipo IN ('F','N','D') AND h.Estado <> 'A'
        GROUP BY h.Folio
      )
      SELECT
        h.Folio,
        CONVERT(VARCHAR(10), h.Fecha, 103)                                  AS fecha_formato,
        c.NomAux                                                            AS cliente,
        h.CodVendedor,
        h.Tipo,
        ROUND(SUM(m.TotLinea), 0)                                           AS monto,
        ROUND(SUM(m.TotLinea), 0)                                           AS venta_real_folio,
        ROUND(SUM(
          CASE
            WHEN h.Tipo = 'N' AND m.CodProd LIKE 'NC%'
              THEN ISNULL(m.TotLinea, 0)
            WHEN cl.CodCan = '301'
              THEN ISNULL(m.CantFacturada, 0) * ISNULL(t.PrecioVta, 0) * 1.10
            ELSE ISNULL(m.CantFacturada, 0) * ISNULL(t.PrecioVta, 0)
          END
        ), 0)                                                               AS TotLineaReal,
        ROUND(SUM(ISNULL(m.CantFacturada, 0) * ISNULL(t.PrecioVta, 0)), 0) AS neto_lista,
        ROUND(
          CASE
            WHEN SUM(ISNULL(m.CantFacturada, 0) * ISNULL(t.PrecioVta, 0)) <> 0
            THEN (1 - (
              ABS(SUM(m.TotLinea)) /
              NULLIF(ABS(SUM(ISNULL(m.CantFacturada, 0) * ISNULL(t.PrecioVta, 0))), 0)
            )) * 100
            ELSE 0
          END
        , 0)                                                                AS pct_descuento,
        ISNULL(fc.EsCompartido, 0)                                          AS es_compartido,
        COUNT(m.Linea)                                                      AS cant_lineas
      FROM [PRODIN].[softland].[iw_gsaen] h
      LEFT JOIN [PRODIN].[softland].[cwtauxi]  c  ON c.CodAux  = h.CodAux
      LEFT JOIN [PRODIN].[softland].[cwtcvcl]  cl ON cl.CodAux = h.CodAux
      LEFT JOIN [PRODIN].[softland].[iw_gmovi] m  ON m.NroInt  = h.NroInt AND m.Tipo = h.Tipo
      LEFT JOIN [PRODIN].[softland].[iw_tprod] t  ON t.CodProd = m.CodProd
      LEFT JOIN FoliosCompartidos              fc ON fc.Folio   = h.Folio
      WHERE (h.CodVendedor IN (${mssqlIn(codigos)}) ${extraFolios})
        AND MONTH(h.Fecha) = ${mes} AND YEAR(h.Fecha) = ${anio}
        AND h.Tipo IN ('F','N','D') AND h.Estado <> 'A'
      GROUP BY h.Folio, h.Fecha, h.Tipo, c.NomAux, h.CodVendedor, h.NroInt, fc.EsCompartido
      ORDER BY h.Fecha DESC, h.Folio
    `);
    const ventas = result.recordset.map(v => {
      const montoBase = Math.round(Number(v.monto) * factor);
      const ventaRealFolio = Math.round(Number(v.venta_real_folio) || 0);
      const totLineaReal = Math.round(Number(v.TotLineaReal) || 0);
      if (v.es_compartido) {
        const pctInfo = foliosCompPct.find(r => r.folio === Number(v.Folio));
        if (pctInfo) return {
          ...v,
          monto:          montoBase,
          venta_real_folio: ventaRealFolio,
          TotLineaReal: Math.round(totLineaReal * pctInfo.porcentaje / 100),
          monto_asignado: Math.round(montoBase * pctInfo.porcentaje / 100),
          porcentaje_asignado: pctInfo.porcentaje,
        };
      }
      return { ...v, monto: montoBase, venta_real_folio: ventaRealFolio, TotLineaReal: totLineaReal };
    });
    res.json({ ok: true, ventas, factor });
  } catch (err) {
    console.error('[GET /api/dashboard/ventas-mes]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener ventas del mes' });
  }
});

// ── GET /api/dashboard/detalle/:folio ─────────────────────────────────────
//
// Fórmula correcta de precio histórico (FIX 2026-04-29 b):
//
//   precio_unitario_cobrado   = TotLinea / CantFacturada
//   precio_unitario_historico = precio_unitario_cobrado * factor
//   valor_historico_linea     = precio_unitario_historico * CantFacturada
//
// Se parte del precio REAL cobrado, no del precio lista de Softland.
// PrecioVta se devuelve en el response solo como referencia informativa.
router.get('/detalle/:folio', async (req, res) => {
  let folio;
  try { folio = validateFolio(req.params.folio); }
  catch (err) { return res.status(400).json({ ok: false, error: err.message }); }

  try {
    const pool = await getSoftlandPool();

    // ── Paso 1: obtener mes/anio del folio para derivar el factor histórico
    const resultFecha = await pool.request().query(`
      SELECT TOP 1 MONTH(Fecha) AS mes, YEAR(Fecha) AS anio
      FROM [PRODIN].[softland].[iw_gsaen]
      WHERE Folio = ${folio} AND Tipo IN ('F','N','D') AND Estado <> 'A'
    `);
    if (!resultFecha.recordset.length) {
      return res.status(404).json({ ok: false, error: 'Folio no encontrado' });
    }
    const { mes: mesFolio, anio: anioFolio } = resultFecha.recordset[0];

    // ── Paso 2: calcular factor histórico acumulado desde MySQL
    // factor = ∏ (1 - tasa_i/100) para todas las tasas posteriores al período
    const factor = await getFactorHistorico(mesFolio, anioFolio);

    // ── Paso 3: traer detalle de líneas desde Softland
    // PrecioVta se trae solo como dato informativo (precio lista vigente)
    const result = await pool.request().query(`
      SELECT
        gsaen.Folio,
        CONVERT(VARCHAR(10), gsaen.Fecha, 103)  AS Fecha,
        gsaen.CodVendedor,
        gsaen.CanCod,
        cwtauxi.nomAux                          AS Cliente,
        gmovi.CodProd,
        tprod.DesProd,
        gmovi.CantFacturada,
        gmovi.TotLinea,
        tprod.PrecioVta
      FROM [PRODIN].[softland].[iw_gmovi] gmovi
      INNER JOIN [PRODIN].[softland].[iw_gsaen]  gsaen   ON gsaen.NroInt  = gmovi.NroInt  AND gsaen.Tipo  = gmovi.Tipo
      INNER JOIN [PRODIN].[softland].[iw_tprod]  tprod   ON tprod.CodProd = gmovi.CodProd
      INNER JOIN [PRODIN].[softland].[cwtauxi]   cwtauxi ON cwtauxi.CodAux = gsaen.CodAux
      WHERE gsaen.Tipo IN ('F','N','D')
        AND gsaen.Folio = ${folio}
      ORDER BY gmovi.CodProd
    `);

    // ── Paso 4: calcular precio histórico basado en TotLinea / CantFacturada
    //
    // La base siempre es lo que realmente se cobró (TotLinea),
    // NO el precio lista de Softland (PrecioVta).
    const detalle = result.recordset.map(row => {
      const cantFacturada = Number(row.CantFacturada) || 0;
      const totLinea      = Number(row.TotLinea)      || 0;

      // Precio unitario real cobrado en el período
      const precioUnitarioCobrado = cantFacturada > 0
        ? totLinea / cantFacturada
        : 0;

      // Precio unitario llevado al valor del período histórico
      // (aplicando los aumentos que aún no habían ocurrido)
      const precioUnitarioHistorico = precioUnitarioCobrado * factor;

      // Valor total de la línea en términos históricos
      const valorHistoricoLinea = precioUnitarioHistorico * cantFacturada;

      return {
        Folio:                      row.Folio,
        Fecha:                      row.Fecha,
        CodVendedor:                row.CodVendedor,
        CanCod:                     row.CanCod,
        Cliente:                    row.Cliente,
        CodProd:                    row.CodProd,
        DesProd:                    row.DesProd,
        CantFacturada:              cantFacturada,
        TotLinea:                   Math.round(totLinea),
        precio_unitario_cobrado:    Math.round(precioUnitarioCobrado),
        precio_unitario_historico:  Math.round(precioUnitarioHistorico),
        valor_historico_linea:      Math.round(valorHistoricoLinea),
        precio_lista_actual:        Math.round(Number(row.PrecioVta) || 0),
        factor_aplicado:            Math.round(factor * 1e6) / 1e6,
      };
    });

    res.json({ ok: true, folio, factor, mesFolio, anioFolio, detalle });
  } catch (err) {
    console.error('[GET /api/dashboard/detalle]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener detalle del folio' });
  }
});

// ── GET /api/dashboard/compartir/lista ─────────────────────────────────
router.get('/compartir/lista', async (req, res) => {
  const usuario = req.usuario, codigosCoord = getCodigosCoordinador(usuario), hoy = new Date();
  const { validarMesAnio } = require('../utils/stringHelpers');
  let mes, anio;
  try { ({ mes, anio } = validarMesAnio(req.query.mes ?? (hoy.getMonth() + 1), req.query.anio ?? hoy.getFullYear())); }
  catch (err) { return res.status(400).json({ ok: false, error: err.message }); }
  if (!codigosCoord.length) return res.json({ ok: false, error: 'No autorizado para compartir' });
  try {
    // FIX 2026-06-17 (a): sin filtro mes/anio — un folio asignado en cualquier
    // período no debe aparecer como disponible en el selector.
    const foliosYaAsignados = await getFoliosYaAsignados(codigosCoord);
    const excludeClause = foliosYaAsignados.length ? `AND h.Folio NOT IN (${foliosYaAsignados.join(',')})` : '';
    const pool = await getSoftlandPool();
    const result = await pool.request().query(`
      SELECT TOP 200
        h.Folio,
        CONVERT(varchar, h.Fecha, 103) AS fecha_formato,
        c.NomAux AS cliente,
        ROUND(SUM(m.TotLinea), 0)      AS monto,
        h.CodVendedor
      FROM [PRODIN].[softland].[iw_gsaen] h
      LEFT JOIN [PRODIN].[softland].[cwtauxi] c ON c.CodAux = h.CodAux
      INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = h.NroInt AND m.Tipo = h.Tipo
      WHERE h.CodVendedor IN (${mssqlIn(codigosCoord)})
        AND MONTH(h.Fecha) = ${mes} AND YEAR(h.Fecha) = ${anio}
        AND h.Tipo IN ('F','N','D') AND h.Estado <> 'A'
        ${excludeClause}
      GROUP BY h.Folio, h.Fecha, c.NomAux, h.CodVendedor
      ORDER BY h.Fecha DESC
    `);
    res.json({ ok: true, folios: result.recordset });
  } catch (err) {
    console.error('[GET /dashboard/compartir/lista]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener folios' });
  }
});

// ── POST /api/dashboard/compartir
router.post('/compartir', async (req, res) => {
  const usuario = req.usuario, codigosCoord = getCodigosCoordinador(usuario);
  let folio, cod_vendedor_compartido, porcentaje;
  try {
    folio                   = validateFolio(req.body.folio);
    cod_vendedor_compartido = validateCodVendedor(req.body.cod_vendedor_compartido);
    porcentaje              = validatePorcentaje(req.body.porcentaje);
  } catch (err) { return res.status(400).json({ ok: false, error: err.message }); }
  if (!codigosCoord.length) return res.status(403).json({ ok: false, error: 'No autorizado' });
  try {
    const pool = await getSoftlandPool();
    const resultFolio = await pool.request().query(`
      SELECT TOP 1 h.Folio, h.Fecha, h.CodVendedor, c.NomAux AS cliente,
        SUM(m.TotLinea) AS montoBase
      FROM [PRODIN].[softland].[iw_gsaen] h
      LEFT JOIN [PRODIN].[softland].[cwtauxi] c ON c.CodAux = h.CodAux
      INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = h.NroInt AND m.Tipo = h.Tipo
      WHERE h.Folio = ${folio}
        AND h.CodVendedor IN (${mssqlIn(codigosCoord)})
        AND h.Tipo IN ('F','N','D') AND h.Estado <> 'A'
      GROUP BY h.Folio, h.Fecha, h.CodVendedor, c.NomAux
    `);
    if (!resultFolio.recordset.length) return res.status(404).json({ ok: false, error: 'Folio no encontrado o no autorizado' });
    const f = resultFolio.recordset[0];
    const montoBase     = Number(f.montoBase);
    const montoAsignado = Math.round(montoBase * porcentaje / 100);
    const fechaFolio    = new Date(f.Fecha);
    const mesF = fechaFolio.getMonth() + 1, anioF = fechaFolio.getFullYear();
    const nombreVendedorComp  = await getNombreVendedor(cod_vendedor_compartido);
    const nombreCoordinador   = usuario.nombre || `Coordinador (${f.CodVendedor})`;
    await db.pool.query(
      `INSERT INTO factura_compartida(folio,anio,mes,fecha,cliente,monto_neto,monto_asignado,porcentaje,rol,
        cod_vendedor_principal,cod_vendedor_compartido,nombre_vendedor_compartido,fecha_registro,usuario_id)
       VALUES(?,?,?,?,?,?,?,?,'compartido',?,?,?,NOW(),?)`,
      [String(f.Folio), anioF, mesF, fechaFolio.toISOString().slice(0, 10), f.cliente || '',
       montoBase, montoAsignado, porcentaje, f.CodVendedor, cod_vendedor_compartido, nombreVendedorComp, usuario.sub]
    );
    const usuarioIdReceptor = await notificacionModel.usuarioIdDesdeCodVendedor(cod_vendedor_compartido);
    if (usuarioIdReceptor) {
      notificacionModel.notificarFolioRecibido({ usuarioIdReceptor, folio: Number(f.Folio), cliente: f.cliente || '', monto: montoAsignado, porcentaje, nombreCoordinador, mes: mesF, anio: anioF }).catch(e => console.error('[notif]', e.message));
    }
    notificacionModel.notificarFolioAsignado({ usuarioIdCoordinador: usuario.sub, folio: Number(f.Folio), cliente: f.cliente || '', nombreVendedor: nombreVendedorComp, porcentaje, mes: mesF, anio: anioF }).catch(e => console.error('[notif]', e.message));
    res.json({ ok: true, message: 'Folio compartido correctamente' });
  } catch (err) {
    console.error('[POST /dashboard/compartir]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PUT /api/dashboard/compartir/:id
router.put('/compartir/:id', async (req, res) => {
  const usuario = req.usuario, codigosCoord = getCodigosCoordinador(usuario);
  let id, cod_vendedor_compartido, porcentaje;
  try {
    id                      = validateId(req.params.id);
    cod_vendedor_compartido = validateCodVendedor(req.body.cod_vendedor_compartido);
    porcentaje              = validatePorcentaje(req.body.porcentaje);
  } catch (err) { return res.status(400).json({ ok: false, error: err.message }); }
  if (!codigosCoord.length) return res.status(403).json({ ok: false, error: 'No autorizado' });
  try {
    const [rows] = await db.pool.query(
      `SELECT id, monto_neto, folio, cliente, mes, anio FROM factura_compartida
       WHERE id = ? AND cod_vendedor_principal IN (${codigosCoord.map(() => '?').join(',')}) LIMIT 1`,
      [id, ...codigosCoord]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Asignación no encontrada' });
    const reg = rows[0];
    const montoAsignado       = Math.round(Number(reg.monto_neto) * porcentaje / 100);
    const nombreVendedorComp  = await getNombreVendedor(cod_vendedor_compartido);
    await db.pool.query(
      `UPDATE factura_compartida SET cod_vendedor_compartido=?, nombre_vendedor_compartido=?, porcentaje=?, monto_asignado=? WHERE id=?`,
      [cod_vendedor_compartido, nombreVendedorComp, porcentaje, montoAsignado, id]
    );
    const usuarioIdReceptor = await notificacionModel.usuarioIdDesdeCodVendedor(cod_vendedor_compartido);
    if (usuarioIdReceptor) {
      notificacionModel.notificarFolioRecibido({ usuarioIdReceptor, folio: Number(reg.folio), cliente: reg.cliente || '', monto: montoAsignado, porcentaje, nombreCoordinador: usuario.nombre || 'Coordinador', mes: Number(reg.mes), anio: Number(reg.anio) }).catch(e => console.error('[notif]', e.message));
    }
    notificacionModel.notificarFolioAsignado({ usuarioIdCoordinador: usuario.sub, folio: Number(reg.folio), cliente: reg.cliente || '', nombreVendedor: nombreVendedorComp, porcentaje, mes: Number(reg.mes), anio: Number(reg.anio) }).catch(e => console.error('[notif]', e.message));
    res.json({ ok: true, message: 'Asignación actualizada' });
  } catch (err) {
    console.error('[PUT /dashboard/compartir/:id]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── DELETE /api/dashboard/compartir/:id
router.delete('/compartir/:id', async (req, res) => {
  const usuario = req.usuario, codigosCoord = getCodigosCoordinador(usuario);
  let id;
  try { id = validateId(req.params.id); }
  catch (err) { return res.status(400).json({ ok: false, error: err.message }); }
  if (!codigosCoord.length) return res.status(403).json({ ok: false, error: 'No autorizado' });
  try {
    const [rows] = await db.pool.query(
      `SELECT id FROM factura_compartida WHERE id = ? AND cod_vendedor_principal IN (${codigosCoord.map(() => '?').join(',')}) LIMIT 1`,
      [id, ...codigosCoord]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Asignación no encontrada o sin permiso' });
    await db.pool.query('DELETE FROM factura_compartida WHERE id=?', [id]);
    res.json({ ok: true, message: 'Asignación eliminada. El folio está disponible nuevamente.' });
  } catch (err) {
    console.error('[DELETE /dashboard/compartir/:id]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/dashboard/compartidos
router.get('/compartidos', async (req, res) => {
  const usuario = req.usuario, codigos = getCodigos(usuario), hoy = new Date();
  const { validarMesAnio } = require('../utils/stringHelpers');
  let mes, anio;
  try { ({ mes, anio } = validarMesAnio(req.query.mes ?? (hoy.getMonth() + 1), req.query.anio ?? hoy.getFullYear())); }
  catch (err) { return res.status(400).json({ ok: false, error: err.message }); }
  if (!codigos.length) return res.json({ ok: true, compartidos: [] });
  try {
    const ph = codigos.map(() => '?').join(',');
    const [rows] = await db.pool.query(`
      SELECT fc.id, fc.folio, fc.fecha, fc.cliente, fc.monto_neto, fc.monto_asignado, fc.porcentaje,
        fc.cod_vendedor_principal, fc.cod_vendedor_compartido, fc.nombre_vendedor_compartido,
        fc.monto_asignado AS monto, COALESCE(u.nombre, fc.cod_vendedor_principal) AS coordinador
      FROM factura_compartida fc
      LEFT JOIN usuario_vendedor uv ON uv.cod_vendedor = fc.cod_vendedor_principal
      LEFT JOIN usuario u ON u.id = uv.usuario_id
      WHERE fc.cod_vendedor_compartido IN (${ph}) AND fc.mes = ? AND fc.anio = ? AND fc.rol = 'compartido'
      ORDER BY fc.fecha DESC
    `, [...codigos, mes, anio]);
    res.json({ ok: true, compartidos: rows });
  } catch (err) {
    console.error('[GET /dashboard/compartidos]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener compartidos' });
  }
});

// ── GET /api/dashboard/asignados
//
// FIX 2026-06-17 (b): eliminado filtro mes/anio.
// El INSERT guarda el mes real del folio en Softland (ej. mes=4 para abril).
// Si el coordinador asignaba un folio de abril desde el panel de marzo,
// el registro quedaba con mes=4 y no aparecía en la tabla de "asignados este mes"
// del panel de marzo, ni en el panel de junio a menos que cambiara al mes correcto.
// Ahora se devuelven todos los folios asignados por el coordinador sin filtro de período,
// ordenados por fecha descendente.
router.get('/asignados', async (req, res) => {
  const usuario = req.usuario, codigosCoord = getCodigosCoordinador(usuario);
  if (!codigosCoord.length) return res.json({ ok: true, asignados: [] });
  try {
    const ph = codigosCoord.map(() => '?').join(',');
    const [rows] = await db.pool.query(`
      SELECT fc.id, fc.folio, fc.fecha, fc.cliente, fc.monto_neto, fc.monto_asignado, fc.porcentaje,
        fc.cod_vendedor_principal, fc.cod_vendedor_compartido, fc.nombre_vendedor_compartido,
        fc.mes, fc.anio
      FROM factura_compartida fc
      WHERE fc.cod_vendedor_principal IN (${ph}) AND fc.rol = 'compartido'
      ORDER BY fc.fecha DESC
    `, [...codigosCoord]);
    res.json({ ok: true, asignados: rows });
  } catch (err) {
    console.error('[GET /dashboard/asignados]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener asignados' });
  }
});

// ── GET /api/dashboard/clientes-resumen ──────────────────────────────────
// Devuelve por cada código de vendedor del usuario logueado:
//   - totalClientesHist   : clientes distintos con al menos un documento
//                           (F/N/D no anulado) en cualquier período
//   - totalClientesPeriodo: clientes distintos con documentos en el mes/año
//                           seleccionado
//
// FUENTE ÚNICA: iw_gsaen con filtros Tipo IN ('F','N','D') AND Estado <> 'A'
// (antes se usaba cwtauxven para el histórico, que daba un número fijo
//  independiente de documentos reales emitidos — FIX 2026-06-09)
// ── GET /categorias-vendedor ──────────────────────────────────────────────────
// Distribución de ventas por categoría de producto para el gráfico de tortas.
// Doble fuente: SQL Server (ventas por CtaVentas) + MySQL (categoriasproducto).
// El JOIN se realiza en Node.js para no requerir replicación de tablas.
router.get('/categorias-vendedor', async (req, res) => {
  const usuario = req.usuario;
  const codigos = getCodigos(usuario);
  const hoy = new Date();
  const { validarMesAnio } = require('../utils/stringHelpers');
  let mes, anio;
  try {
    ({ mes, anio } = validarMesAnio(req.query.mes ?? (hoy.getMonth() + 1), req.query.anio ?? hoy.getFullYear()));
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
  if (!codigos.length) return res.json({ ok: true, vendedores: [] });

  try {
    // 1. MySQL: tabla de categorías (pequeña, carga única)
    const [catRows] = await db.pool.query('SELECT Cta, Categoria FROM categoriasproducto');
    const catMap = Object.fromEntries(catRows.map(r => [r.Cta, r.Categoria]));

    // 2. SQL Server: ventas agrupadas por CtaVentas, un query por vendedor
    const pool = await getSoftlandPool();
    const resultado = [];

    for (const cod of codigos) {
      const r = await pool.request().query(`
        SELECT
          t.CtaVentas,
          SUM(m.TotLinea) AS TotalVentas
        FROM [PRODIN].[softland].[iw_gsaen]  h
          INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = h.NroInt AND m.Tipo = h.Tipo
          INNER JOIN [PRODIN].[softland].[iw_tprod] t ON t.CodProd = m.CodProd
        WHERE h.CodVendedor = '${cod}'
          AND h.Tipo IN ('F','N','D')
          AND h.Estado <> 'A'
          AND h.Fecha >= DATEFROMPARTS(${anio}, ${mes}, 1)
          AND h.Fecha <  DATEADD(MONTH, 1, DATEFROMPARTS(${anio}, ${mes}, 1))
          AND t.CtaVentas IS NOT NULL
        GROUP BY t.CtaVentas
        ORDER BY TotalVentas DESC
      `);

      // 3. Node.js JOIN: agrupa por Categoria usando catMap
      const aggMap = {};
      for (const row of r.recordset) {
        const cat = catMap[row.CtaVentas] || 'Otros';
        aggMap[cat] = (aggMap[cat] || 0) + Number(row.TotalVentas);
      }
      const categorias = Object.entries(aggMap)
        .map(([categoria, total]) => ({ categoria, total }))
        .sort((a, b) => b.total - a.total);

      resultado.push({ codVendedor: cod, categorias });
    }

    // Devolver la lista única de categorías desde MySQL (sin duplicados)
    const todasLasCategorias = [...new Set(catRows.map(r => r.Categoria))];
    res.json({ ok: true, vendedores: resultado, todasLasCategorias });
  } catch (err) {
    console.error('[GET /dashboard/categorias-vendedor]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener categorías de ventas' });
  }
});

router.get('/clientes-resumen', async (req, res) => {
  const usuario = req.usuario;
  const codigos = getCodigos(usuario);
  const hoy = new Date();
  const { validarMesAnio } = require('../utils/stringHelpers');
  let mes, anio;
  try {
    ({ mes, anio } = validarMesAnio(req.query.mes ?? (hoy.getMonth() + 1), req.query.anio ?? hoy.getFullYear()));
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
  if (!codigos.length) return res.json({ ok: true, clientes: [] });

  try {
    const pool = await getSoftlandPool();
    const resultado = [];

    for (const cod of codigos) {
      const r = await pool.request().query(`
        SELECT
          '${cod}' AS CodVendedor,
          (
            SELECT COUNT(DISTINCT CodAux)
            FROM [PRODIN].[softland].[iw_gsaen]
            WHERE CodVendedor = '${cod}'
              AND Tipo IN ('F','N','D')
              AND Estado <> 'A'
          ) AS TotalClientesHist,
          (
            SELECT COUNT(DISTINCT CodAux)
            FROM [PRODIN].[softland].[iw_gsaen]
            WHERE CodVendedor = '${cod}'
              AND Tipo IN ('F','N','D')
              AND Estado <> 'A'
              AND Fecha >= DATEFROMPARTS(${anio}, ${mes}, 1)
              AND Fecha <  DATEADD(MONTH, 1, DATEFROMPARTS(${anio}, ${mes}, 1))
          ) AS TotalClientesPeriodo
      `);
      if (r.recordset.length) {
        resultado.push({
          codVendedor:          r.recordset[0].CodVendedor,
          totalClientesHist:    Number(r.recordset[0].TotalClientesHist)    || 0,
          totalClientesPeriodo: Number(r.recordset[0].TotalClientesPeriodo) || 0,
        });
      }
    }

    res.json({ ok: true, clientes: resultado });
  } catch (err) {
    console.error('[GET /dashboard/clientes-resumen]', err.message);
    res.status(500).json({ ok: false, error: 'Error al obtener resumen de clientes' });
  }
});

module.exports = router;
