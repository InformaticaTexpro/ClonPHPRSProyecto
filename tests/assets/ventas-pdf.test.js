'use strict';

const fs = require('fs');
const path = require('path');

const VENTAS_JS = fs.readFileSync(
  path.join(__dirname, '../../src/modulo/ventas/ventas/ventas.js'),
  'utf8'
);

describe('ventas PDF report', () => {
  test('define title, filename and grouping helpers for each PDF mode', () => {
    expect(VENTAS_JS).toContain("function tituloPDFReporte(modo, codigo, nombreVendedor = '')");
    expect(VENTAS_JS).toContain('TEXPRO — Reporte de Ventas Asignadas');
    expect(VENTAS_JS).toContain('TEXPRO — Reporte Vendedor');
    expect(VENTAS_JS).toContain('TEXPRO — Reporte Vendedores');
    expect(VENTAS_JS).toContain('Ventas Compartidas —');
    expect(VENTAS_JS).toContain('Todos mis códigos —');
    expect(VENTAS_JS).toContain('function nombreArchivoPDFReporte(modo, codigo, mesLabel)');
    expect(VENTAS_JS).toContain('reporte_ventas_vendedor_');
    expect(VENTAS_JS).toContain('reporte_ventas_todos_los_codigos_');
    expect(VENTAS_JS).toContain('reporte_ventas_compartidos_');
    expect(VENTAS_JS).toContain('function agruparVentasPorCodigoPDF(ventas)');
    expect(VENTAS_JS).toContain('function codigosUsuarioPDF()');
    expect(VENTAS_JS).toContain('function esCodigoPermitidoPDF(codigo)');
    expect(VENTAS_JS).toContain('function combinarCompartidosPDF()');
  });

  test('keeps UTF-8 labels visible in the PDF layout', () => {
    expect(VENTAS_JS).toContain('Cód. Cliente');
    expect(VENTAS_JS).toContain('Asignación folio');
    expect(VENTAS_JS).toContain('% Participación');
    expect(VENTAS_JS).toContain('Período');
    expect(VENTAS_JS).toContain('Página');
    expect(VENTAS_JS).toContain('Vendedor asignado');
    expect(VENTAS_JS).not.toContain('Ã');
    expect(VENTAS_JS).not.toContain('ðŸ');
  });
});
