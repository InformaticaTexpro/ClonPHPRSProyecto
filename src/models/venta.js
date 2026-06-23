'use strict';

/**
 * venta.js — Modelo de Ventas
 * Todas las queries apuntan a [PRODIN].[softland].*
 * Conexión via mssql (getSoftlandPool)
 *
 * Reglas de negocio aplicadas:
 *  1. Precio histórico: PrecioVta vigente se divide por el acumulado de alzas
 *     posteriores a la fecha del documento (tasas_descuentos en MySQL).
 *  2. Productos NC% (LIKE 'NC%'): el precio real es TotLinea/CantFacturada.
 *  3. Canal 301: precio de lista base se multiplica x1.1 antes del divisor.
 *  4. Estado <> 'A': se excluyen documentos anulados en todos los cálculos.
 */

const { getSoftlandPool, sql } = require('../config/db.softland');
const db                       = require('../config/db');
const { buildPrecioListaRealCASE, buildDivisorCASE } = require('../utils/precioHistorico');

function buildInParams(request, codigos, prefijo = 'cod') {
  const names = codigos.map((c, i) => {
    const name = `${prefijo}${i}`;
    request.input(name, sql.VarChar(20), String(c));
    return `@${name}`;
  });
  return names.join(',');
}

async function getTotalVentas({ codigos, mes, anio }) {
  const pool    = await getSoftlandPool();
  const request = pool.request();

  request.input('mes',  sql.Int, Number(mes));
  request.input('anio', sql.Int, Number(anio));
  const inCods = buildInParams(request, codigos);

  const result = await request.query(`
    SELECT SUM(m.TotLinea) AS total_ventas
    FROM [PRODIN].[softland].[iw_gmovi] m
    INNER JOIN [PRODIN].[softland].[iw_gsaen] enc
      ON enc.NroInt = m.NroInt
     AND enc.Tipo   = m.Tipo
    WHERE enc.Tipo         IN ('F','N','D')
      AND enc.Estado       <>  'A'
      AND enc.CodVendedor  IN (${inCods})
      AND MONTH(enc.Fecha) =   @mes
      AND YEAR(enc.Fecha)  =   @anio
  `);

  return result.recordset[0]?.total_ventas ?? 0;
}

async function getResumenPorVendedor({ codigos, mes, anio }) {
  const pool    = await getSoftlandPool();
  const request = pool.request();

  request.input('mes',  sql.Int, Number(mes));
  request.input('anio', sql.Int, Number(anio));
  const inCods = buildInParams(request, codigos);

  const precioListaRealCASE = await buildPrecioListaRealCASE(db, {
    campoFecha:     'gsaen.Fecha',
    campoCodProd:   'gmovi.CodProd',
    campoTotLinea:  'gmovi.TotLinea',
    campoCant:      'gmovi.CantFacturada',
    campoPrecioVta: 'tprod.PrecioVta',
    campoCodCan:    'cvl.CodCan',
  });

  const result = await request.query(`
    SELECT
      gsaen.CodVendedor                                          AS codigo_vendedor,
      cwtvend.VenDes                                             AS nombre_vendedor,
      ROUND(SUM(
        gmovi.CantFacturada * (${precioListaRealCASE})
      ), 0)                                                      AS precio_vta,
      ROUND(SUM(gmovi.TotLinea), 0)                              AS total_ventas,
      CASE
        WHEN SUM(gmovi.CantFacturada * (${precioListaRealCASE})) > 0
        THEN ROUND(
          (1 - SUM(gmovi.TotLinea)
             / NULLIF(SUM(gmovi.CantFacturada * (${precioListaRealCASE})), 0)
          ) * 100, 2)
        ELSE 0
      END                                                        AS pct_descuento
    FROM [PRODIN].[softland].[iw_gmovi] gmovi
    INNER JOIN [PRODIN].[softland].[iw_gsaen] gsaen
      ON gsaen.Tipo    = gmovi.Tipo
     AND gsaen.NroInt  = gmovi.NroInt
    INNER JOIN [PRODIN].[softland].[cwtvend] cwtvend
      ON cwtvend.VenCod = gsaen.CodVendedor
    INNER JOIN [PRODIN].[softland].[iw_tprod] tprod
      ON tprod.CodProd = gmovi.CodProd
    LEFT JOIN [PRODIN].[softland].[cwtcvcl] cvl
      ON cvl.CodAux = gsaen.CodAux
    WHERE gsaen.Tipo         IN ('F','N','D')
      AND gsaen.Estado       <>  'A'
      AND MONTH(gsaen.Fecha) =   @mes
      AND YEAR(gsaen.Fecha)  =   @anio
      AND gsaen.CodVendedor  IN (${inCods})
    GROUP BY gsaen.CodVendedor, cwtvend.VenDes
    ORDER BY gsaen.CodVendedor
  `);

  return result.recordset;
}

async function getClientesPorVendedor({ codigos, mes, anio }) {
  const pool    = await getSoftlandPool();
  const request = pool.request();

  request.input('mes',  sql.Int, Number(mes));
  request.input('anio', sql.Int, Number(anio));
  const inCods = buildInParams(request, codigos);

  const result = await request.query(`
    SELECT
      iw_gsaen.CodVendedor                          AS codigo_vendedor,
      cwtauxi.nomAux                                AS nombre_cliente,
      SUM(iw_gsaen.SubTotal)                        AS total_ventas,
      CONVERT(VARCHAR(10), iw_gsaen.Fecha, 103)     AS fecha
    FROM [PRODIN].[softland].[iw_gsaen]
    INNER JOIN [PRODIN].[softland].[cwtauxi] cwtauxi
      ON cwtauxi.codaux = iw_gsaen.codaux
    INNER JOIN [PRODIN].[softland].[cwtvend] cwtvend
      ON cwtvend.VenCod = iw_gsaen.CodVendedor
    WHERE iw_gsaen.Tipo         IN ('F','N','D')
      AND iw_gsaen.Estado       <>  'A'
      AND MONTH(iw_gsaen.fecha) =   @mes
      AND YEAR(iw_gsaen.fecha)  =   @anio
      AND iw_gsaen.CodVendedor  IN (${inCods})
    GROUP BY
      iw_gsaen.CodVendedor,
      cwtauxi.nomAux,
      CONVERT(VARCHAR(10), iw_gsaen.Fecha, 103)
    ORDER BY
      iw_gsaen.CodVendedor,
      CONVERT(VARCHAR(10), iw_gsaen.Fecha, 103)
  `);

  return result.recordset;
}

async function getVentas({ codigos, mes, anio }) {
  const pool    = await getSoftlandPool();
  const request = pool.request();

  request.input('mes',  sql.Int, Number(mes));
  request.input('anio', sql.Int, Number(anio));
  const inCods = buildInParams(request, codigos);

  const result = await request.query(`
    SELECT
      gsaen.Folio,
      CONVERT(VARCHAR(10), gsaen.Fecha, 103) AS fecha_formato,
      gsaen.SubTotal                         AS monto,
      gsaen.CodVendedor,
      RTRIM(gsaen.CodAux)                    AS cod_cliente,
      cwtauxi.nomAux                         AS cliente,
      COALESCE(gsaen.TotDesc, 0)             AS descuento
    FROM [PRODIN].[softland].[iw_gsaen] gsaen
    INNER JOIN [PRODIN].[softland].[cwtauxi] cwtauxi
      ON cwtauxi.codaux = gsaen.codaux
    WHERE gsaen.CodVendedor  IN (${inCods})
      AND MONTH(gsaen.Fecha) =   @mes
      AND YEAR(gsaen.Fecha)  =   @anio
      AND gsaen.Tipo         IN ('F','N','D')
      AND gsaen.Estado       <>  'A'
    ORDER BY gsaen.Fecha DESC
  `);

  return result.recordset;
}

async function getMontoFolio({ folio, anio }) {
  const pool    = await getSoftlandPool();
  const request = pool.request();

  request.input('folio', sql.Int, Number(folio));
  request.input('anio',  sql.Int, Number(anio));

  const result = await request.query(`
    SELECT
      SubTotal,
      COALESCE(TotDesc, 0) AS descuento
    FROM [PRODIN].[softland].[iw_gsaen]
    WHERE Folio  =  @folio
      AND YEAR(Fecha) = @anio
      AND Tipo   IN ('F','N','D')
      AND Estado <>  'A'
  `);

  return result.recordset[0] ?? null;
}

async function getDetalleFolio({ folio }) {
  const pool    = await getSoftlandPool();
  const request = pool.request();

  request.input('folio', sql.Int, Number(folio));

  const divisorCASE         = await buildDivisorCASE(db, 'gsaen.Fecha');
  const precioListaRealCASE = await buildPrecioListaRealCASE(db, {
    campoFecha:     'gsaen.Fecha',
    campoCodProd:   'gmovi.CodProd',
    campoTotLinea:  'gmovi.TotLinea',
    campoCant:      'gmovi.CantFacturada',
    campoPrecioVta: 'tprod.PrecioVta',
    campoCodCan:    'cvl.CodCan',
  });

  const result = await request.query(`
  WITH base AS (
    SELECT
      gsaen.Folio,
      gsaen.Fecha,
      gsaen.CodVendedor,
      gsaen.CanCod,
      RTRIM(gsaen.CodAux)                                         AS CodAux,
      cvl.CodCan,
      cwtauxi.nomAux                                              AS Cliente,
      gmovi.CodProd,
      tprod.DesProd,
      gmovi.CantFacturada,
      gmovi.TotLinea,
      tprod.PrecioVta,
      ${divisorCASE}                                              AS divisor_historico,
      CASE WHEN cvl.CodCan = 301 THEN 1.10 ELSE 1.0 END          AS factor_canal,
      (${precioListaRealCASE})                                    AS precio_lista_real
    FROM [PRODIN].[softland].[iw_gmovi] gmovi
    INNER JOIN [PRODIN].[softland].[iw_gsaen] gsaen
      ON gsaen.NroInt = gmovi.NroInt
     AND gsaen.Tipo   = gmovi.Tipo
    INNER JOIN [PRODIN].[softland].[iw_tprod] tprod
      ON tprod.CodProd = gmovi.CodProd
    INNER JOIN [PRODIN].[softland].[cwtauxi] cwtauxi
      ON cwtauxi.CodAux = gsaen.CodAux
    LEFT JOIN [PRODIN].[softland].[cwtcvcl] cvl
      ON cvl.CodAux = gsaen.CodAux
    WHERE gsaen.Tipo   IN ('F','N','D')
      AND gsaen.Estado <>  'A'
      AND gsaen.Folio  =   @folio
  ),
  calc AS (
    SELECT *,
      ROUND(TotLinea / NULLIF(CantFacturada, 0), 4)                         AS precio_unitario_cobrado,
      ROUND(
        (TotLinea / NULLIF(CantFacturada, 0)) / NULLIF(divisor_historico, 0)
      , 4)                                                                   AS precio_unitario_cobrado_hist,
      ROUND(precio_lista_real, 4)                                            AS precio_historico_ajustado
    FROM base
  )
  SELECT
    Folio,
    CONVERT(VARCHAR(10), Fecha, 103)                                         AS Fecha,
    CodVendedor,
    CanCod,
    CodCan,
    CodAux,
    Cliente,
    CodProd,
    DesProd,
    CantFacturada,
    TotLinea,
    precio_unitario_cobrado,
    precio_unitario_cobrado_hist,
    PrecioVta,
    precio_lista_real,
    precio_lista_real                                                       AS precio_historico_base,
    precio_historico_ajustado,
    ROUND(precio_lista_real * CantFacturada, 0)                              AS valor_historico_linea,
    ROUND(precio_unitario_cobrado * CantFacturada, 0)                        AS valor_cobrado_linea,
    ROUND(precio_historico_ajustado - precio_unitario_cobrado_hist, 4)       AS descuento_unitario_pesos,
    ROUND(
      (precio_historico_ajustado - precio_unitario_cobrado_hist)
      / NULLIF(precio_historico_ajustado, 0) * 100
    , 2)                                                                     AS pct_descuento,
    ROUND(
      (precio_historico_ajustado - precio_unitario_cobrado_hist) * CantFacturada
    , 0)                                                                     AS descuento_total_pesos
  FROM calc
  ORDER BY CodProd
  `);

  return result.recordset;
}

async function getDescuentosVendedor({ codigos, mes, anio }) {
  const pool    = await getSoftlandPool();
  const request = pool.request();

  request.input('mes',  sql.Int, Number(mes));
  request.input('anio', sql.Int, Number(anio));
  const inCods = buildInParams(request, codigos);

  const precioListaRealCASE = await buildPrecioListaRealCASE(db, {
    campoFecha:     'gsaen.Fecha',
    campoCodProd:   'gmovi.CodProd',
    campoTotLinea:  'gmovi.TotLinea',
    campoCant:      'gmovi.CantFacturada',
    campoPrecioVta: 'tprod.PrecioVta',
    campoCodCan:    'cvl.CodCan',
  });

  const result = await request.query(`
    SELECT
      gsaen.CodVendedor                                          AS codigo_vendedor,
      cwtvend.VenDes                                             AS nombre_vendedor,
      COUNT(DISTINCT gsaen.Folio)                                AS cantidad_folios,
      ROUND(SUM(gmovi.TotLinea), 0)                              AS total_ventas,
      ROUND(SUM(
        gmovi.CantFacturada * (${precioListaRealCASE})
      ), 0)                                                      AS total_lista_real,
      ROUND(
        (1 - SUM(gmovi.TotLinea)
           / NULLIF(SUM(gmovi.CantFacturada * (${precioListaRealCASE})), 0)
        ) * 100
      , 2)                                                       AS pct_descuento_promedio
    FROM [PRODIN].[softland].[iw_gsaen] gsaen
    INNER JOIN [PRODIN].[softland].[iw_gmovi] gmovi
      ON gmovi.NroInt = gsaen.NroInt
     AND gmovi.Tipo   = gsaen.Tipo
    INNER JOIN [PRODIN].[softland].[cwtvend] cwtvend
      ON cwtvend.VenCod = gsaen.CodVendedor
    INNER JOIN [PRODIN].[softland].[iw_tprod] tprod
      ON tprod.CodProd = gmovi.CodProd
    LEFT JOIN [PRODIN].[softland].[cwtcvcl] cvl
      ON cvl.CodAux = gsaen.CodAux
    WHERE gsaen.Tipo         IN ('F','N','D')
      AND gsaen.Estado       <>  'A'
      AND MONTH(gsaen.Fecha) =   @mes
      AND YEAR(gsaen.Fecha)  =   @anio
      AND gsaen.CodVendedor  IN (${inCods})
    GROUP BY gsaen.CodVendedor, cwtvend.VenDes
    ORDER BY pct_descuento_promedio DESC
  `);

  return result.recordset;
}

module.exports = {
  getTotalVentas,
  getResumenPorVendedor,
  getClientesPorVendedor,
  getVentas,
  getMontoFolio,
  getDetalleFolio,
  getDescuentosVendedor,
};
