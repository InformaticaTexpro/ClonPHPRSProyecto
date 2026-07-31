/**
 * @jest-environment jsdom
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RRHH_HTML = fs.readFileSync(
  path.join(__dirname, '../../src/modulo/rrhh/rrhh/index.html'),
  'utf8'
);

describe('RRHH home', () => {
  test('usa el header global estandar y una portada RRHH propia', () => {
    expect(RRHH_HTML).toContain('header-title">RRHH');
    expect(RRHH_HTML).toContain('header-indicadores');
    expect(RRHH_HTML).toContain('notif-wrapper');
    expect(RRHH_HTML).toContain('header-user-chip');
    expect(RRHH_HTML).toContain('indicadores-header.js');
    expect(RRHH_HTML).toContain('inactividad.js');
    expect(RRHH_HTML).not.toContain('Ir a revisión ventas compartidas');
    expect(RRHH_HTML).not.toContain('rrhh-card-grid');
    expect(RRHH_HTML).toContain('Portada RRHH');
    expect(RRHH_HTML).toContain('La revisión de ventas compartidas quedó disponible como submódulo');
    expect(RRHH_HTML).toContain('rrhh-hero');
    expect(RRHH_HTML).toContain('rrhh-metrics');
    expect(RRHH_HTML).toContain('Agenda de hoy');
    expect(RRHH_HTML).toContain('Alertas internas');
    expect(RRHH_HTML).toContain('Flujo de trabajo RRHH');
    expect(RRHH_HTML).toContain('Equipo en foco');
    expect(RRHH_HTML).toContain('Revisión ventas compartidas');
    expect(RRHH_HTML).toContain('btnActualizarVista');
  });
});
