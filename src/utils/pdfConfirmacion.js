'use strict';
/**
 * utils/pdfConfirmacion.js
 * Genera el PDF de confirmación de ventas usando Puppeteer.
 *
 * Dependencia: npm install puppeteer
 * El PDF se guarda en storage/confirmaciones/ (relativo a la raíz del proyecto).
 */

const path      = require('path');
const fs        = require('fs');
const puppeteer = require('puppeteer');

const STORAGE_DIR = path.join(process.cwd(), 'storage', 'confirmaciones');

/** Asegura que exista el directorio de almacenamiento */
function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

/** Formatea número como moneda CLP */
function fmtCLP(n) {
  if (n == null) return '$0';
  return '$' + Number(n).toLocaleString('es-CL');
}

/** Nombre del mes en español */
const MESES = [
  '', 'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];

/**
 * Genera filas HTML para la tabla de ventas propias.
 */
function filasPropias(ventas) {
  if (!ventas || ventas.length === 0) {
    return '<tr><td colspan="6" style="text-align:center;color:#888">Sin ventas propias en el período</td></tr>';
  }
  return ventas.map(v => `
    <tr>
      <td>${v.Folio ?? ''}</td>
      <td>${v.cod_cliente ?? v.CodAux ?? '—'}</td>
      <td>${v.NomAux ?? v.cliente ?? ''}</td>
      <td>${v.Fecha ? new Date(v.Fecha).toLocaleDateString('es-CL') : (v.fecha_formato ?? '')}</td>
      <td style="text-align:right">${fmtCLP(v.TotLinea ?? v.monto ?? v.monto_neto)}</td>
      <td style="text-align:center">${v.pctDescuento != null ? v.pctDescuento + '%' : '-'}</td>
    </tr>`).join('');
}

/**
 * Genera filas HTML para la tabla de ventas asignadas (factura_compartida).
 */
function filasAsignadas(facturas) {
  if (!facturas || facturas.length === 0) {
    return '<tr><td colspan="6" style="text-align:center;color:#888">Sin ventas asignadas en el período</td></tr>';
  }
  return facturas.map(f => `
    <tr>
      <td>${f.folio ?? ''}</td>
      <td>${f.cod_cliente ?? f.CodAux ?? '—'}</td>
      <td>${f.cliente ?? ''}</td>
      <td>${f.fecha ? new Date(f.fecha).toLocaleDateString('es-CL') : ''}</td>
      <td style="text-align:right">${fmtCLP(f.monto_asignado)}</td>
      <td style="text-align:center">${f.porcentaje ?? 50}%</td>
    </tr>`).join('');
}

/**
 * Genera el HTML completo del reporte.
 */
function generarHTML({ usuario, mes, anio, ventasPropias, ventasAsignadas, meta, totalPropias, totalAsignadas }) {
  const nombreMes = MESES[mes] || mes;
  const ahora     = new Date().toLocaleString('es-CL');
  const cumplimiento = meta > 0
    ? Math.round(((totalPropias + totalAsignadas) / meta) * 100)
    : 0;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 11px;
      color: #222;
      background: #fff;
      padding: 32px 40px;
    }
    /* ── ENCABEZADO ── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 3px solid #01696f;
      padding-bottom: 16px;
      margin-bottom: 20px;
    }
    .header-logo { font-size: 22px; font-weight: 700; color: #01696f; letter-spacing: 2px; }
    .header-logo span { color: #222; }
    .header-title { text-align: right; }
    .header-title h1 { font-size: 16px; font-weight: 700; color: #01696f; margin-bottom: 4px; }
    .header-title p  { font-size: 10px; color: #555; }
    /* ── INFO VENDEDOR ── */
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 32px;
      background: #f4fafa;
      border: 1px solid #cedcd8;
      border-radius: 6px;
      padding: 14px 18px;
      margin-bottom: 20px;
    }
    .info-grid .label { font-size: 9px; color: #888; text-transform: uppercase; letter-spacing: .5px; }
    .info-grid .value { font-size: 12px; font-weight: 600; color: #222; }
    /* ── RESUMEN KPIs ── */
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 24px;
    }
    .kpi {
      background: #fff;
      border: 1px solid #dcd9d5;
      border-radius: 6px;
      padding: 12px 14px;
      text-align: center;
    }
    .kpi .kpi-label { font-size: 9px; color: #888; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 4px; }
    .kpi .kpi-val   { font-size: 15px; font-weight: 700; color: #01696f; }
    .kpi.accent     { background: #01696f; border-color: #01696f; }
    .kpi.accent .kpi-label { color: #cedcd8; }
    .kpi.accent .kpi-val   { color: #fff; }
    /* ── TABLAS ── */
    .section-title {
      font-size: 11px;
      font-weight: 700;
      color: #01696f;
      text-transform: uppercase;
      letter-spacing: .8px;
      border-left: 3px solid #01696f;
      padding-left: 8px;
      margin-bottom: 8px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 24px;
      font-size: 10px;
    }
    thead tr { background: #01696f; color: #fff; }
    thead th { padding: 6px 8px; text-align: left; font-weight: 600; }
    tbody tr:nth-child(even) { background: #f4fafa; }
    tbody tr:hover            { background: #e6f2f2; }
    td { padding: 5px 8px; border-bottom: 1px solid #eee; }
    tfoot tr { background: #f0f0f0; font-weight: 700; }
    tfoot td { padding: 6px 8px; border-top: 2px solid #01696f; }
    /* ── DECLARACIÓN ── */
    .declaration {
      border: 1px solid #cedcd8;
      border-radius: 6px;
      padding: 16px 20px;
      background: #f9f9f7;
      margin-top: 8px;
    }
    .declaration p   { line-height: 1.7; color: #444; font-size: 10.5px; }
    .declaration .sign-row {
      display: flex;
      justify-content: space-between;
      margin-top: 16px;
      font-size: 10px;
      color: #555;
    }
    .badge-confirmado {
      display: inline-block;
      background: #01696f;
      color: #fff;
      font-size: 9px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 20px;
      letter-spacing: .5px;
      margin-left: 8px;
      vertical-align: middle;
    }
    .footer {
      margin-top: 24px;
      border-top: 1px solid #ddd;
      padding-top: 10px;
      font-size: 9px;
      color: #aaa;
      text-align: center;
    }
  </style>
</head>
<body>

  <!-- ENCABEZADO -->
  <div class="header">
    <div>
      <div class="header-logo">TEX<span>PRO</span></div>
      <div style="font-size:9px;color:#888;margin-top:2px">Sistema de Gestión Comercial</div>
    </div>
    <div class="header-title">
      <h1>CONFIRMACIÓN DE VENTAS <span class="badge-confirmado">CONFIRMADO ✓</span></h1>
      <p>Período: <strong>${nombreMes} ${anio}</strong></p>
      <p>Generado: ${ahora}</p>
    </div>
  </div>

  <!-- INFO VENDEDOR -->
  <div class="info-grid">
    <div>
      <div class="label">Vendedor / Coordinador</div>
      <div class="value">${usuario.nombre} ${usuario.apellido}</div>
    </div>
    <div>
      <div class="label">Email</div>
      <div class="value">${usuario.email ?? '-'}</div>
    </div>
    <div>
      <div class="label">ID Usuario</div>
      <div class="value">${usuario.id}</div>
    </div>
    <div>
      <div class="label">Período confirmado</div>
      <div class="value">${nombreMes} ${anio}</div>
    </div>
  </div>

  <!-- KPIs -->
  <div class="kpi-row">
    <div class="kpi">
      <div class="kpi-label">Ventas Propias</div>
      <div class="kpi-val">${fmtCLP(totalPropias)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Ventas Asignadas</div>
      <div class="kpi-val">${fmtCLP(totalAsignadas)}</div>
    </div>
    <div class="kpi accent">
      <div class="kpi-label">Total Confirmado</div>
      <div class="kpi-val">${fmtCLP(totalPropias + totalAsignadas)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Cumplimiento Meta</div>
      <div class="kpi-val">${meta > 0 ? cumplimiento + '%' : 'S/M'}</div>
    </div>
  </div>

  <!-- TABLA VENTAS PROPIAS -->
  <div class="section-title">Ventas Propias (${ventasPropias.length} registros)</div>
  <table>
    <thead>
      <tr>
        <th>Folio</th>
        <th>Cód. Cliente</th>
        <th>Cliente</th>
        <th>Fecha</th>
        <th style="text-align:right">Monto Neto</th>
        <th style="text-align:center">Descuento</th>
      </tr>
    </thead>
    <tbody>${filasPropias(ventasPropias)}</tbody>
    <tfoot>
      <tr>
        <td colspan="4"><strong>TOTAL VENTAS PROPIAS</strong></td>
        <td style="text-align:right"><strong>${fmtCLP(totalPropias)}</strong></td>
        <td></td>
      </tr>
    </tfoot>
  </table>

  <!-- TABLA VENTAS ASIGNADAS -->
  <div class="section-title">Ventas Asignadas / Compartidas (${ventasAsignadas.length} registros)</div>
  <table>
    <thead>
      <tr>
        <th>Folio</th>
        <th>Cód. Cliente</th>
        <th>Cliente</th>
        <th>Fecha</th>
        <th style="text-align:right">Monto Asignado</th>
        <th style="text-align:center">% Particip.</th>
      </tr>
    </thead>
    <tbody>${filasAsignadas(ventasAsignadas)}</tbody>
    <tfoot>
      <tr>
        <td colspan="4"><strong>TOTAL VENTAS ASIGNADAS</strong></td>
        <td style="text-align:right"><strong>${fmtCLP(totalAsignadas)}</strong></td>
        <td></td>
      </tr>
    </tfoot>
  </table>

  <!-- DECLARACIÓN -->
  <div class="declaration">
    <p>
      El suscrito, <strong>${usuario.nombre} ${usuario.apellido}</strong>,
      declara que la información contenida en este reporte es correcta y completa,
      que no presenta descuadres ni información faltante, y que todas las ventas propias
      y asignadas correspondientes al período <strong>${nombreMes} ${anio}</strong>
      se encuentran al día al momento de la confirmación.
    </p>
    <p style="margin-top:10px;font-size:10px;color:#888">
      Este documento fue generado automáticamente por el sistema RSProyecto de Texpro
      y constituye un registro oficial de confirmación. No requiere firma manuscrita.
    </p>
    <div class="sign-row">
      <span>Confirmado por: <strong>${usuario.nombre} ${usuario.apellido}</strong></span>
      <span>Fecha y hora: <strong>${ahora}</strong></span>
      <span>ID Usuario: <strong>${usuario.id}</strong></span>
    </div>
  </div>

  <div class="footer">
    RSProyecto · Texpro · Documento generado automáticamente el ${ahora} · Período ${nombreMes} ${anio}
  </div>

</body>
</html>`;
}

/**
 * Genera el PDF y lo guarda en disco.
 * @param {object} datos - { usuario, mes, anio, ventasPropias, ventasAsignadas, meta, totalPropias, totalAsignadas }
 * @returns {Promise<{ rutaPdf: string, nombreArchivo: string }>}
 */
async function generarPdfConfirmacion(datos) {
  ensureStorageDir();

  const nombreArchivo = `confirmacion_u${datos.usuario.id}_${datos.anio}_${String(datos.mes).padStart(2,'0')}.pdf`;
  const rutaAbsoluta  = path.join(STORAGE_DIR, nombreArchivo);
  const rutaRelativa  = path.join('storage', 'confirmaciones', nombreArchivo);

  const html = generarHTML(datos);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path:   rutaAbsoluta,
      format: 'A4',
      margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' },
      printBackground: true,
    });
  } finally {
    await browser.close();
  }

  return { rutaPdf: rutaRelativa, nombreArchivo };
}

module.exports = { generarPdfConfirmacion };
