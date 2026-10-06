-- ============================================================
-- Submenus principales para Cobranza, Adquisiciones y RRHH.
-- Idempotente: actualiza registros existentes sin duplicarlos.
-- No ejecutar automáticamente; aplicar manualmente en bdtexpro.
-- ============================================================

INSERT INTO perfil (codigo, nombre, descripcion, area, es_base, activo)
VALUES
  ('cobranza', 'Cobranza', 'Perfil base para Cobranza', 'cobranza', 1, 1),
  ('adquisiciones', 'Adquisiciones', 'Perfil base para Adquisiciones', 'adquisiciones', 1, 1)
ON DUPLICATE KEY UPDATE
  nombre = VALUES(nombre),
  descripcion = VALUES(descripcion),
  area = VALUES(area),
  es_base = VALUES(es_base),
  activo = VALUES(activo);

INSERT INTO menu (codigo, nombre, grupo, url, icono, orden, activo)
VALUES
  ('cobranza', 'Cobranza', 'Cobranza', '/src/modulo/cobranza/cobranza/index.html', 'wallet', 1, 1),
  ('cobranza_control_notas_venta', 'Control de Notas de Venta', 'Cobranza', '/src/modulo/cobranza/control-notas-venta/index.html', 'receipt', 2, 1),
  ('cobranza_control_clientes', 'Control de Clientes', 'Cobranza', '/src/modulo/cobranza/control-clientes/index.html', 'users', 3, 1),
  ('adquisiciones', 'Adquisiciones', 'Adquisiciones', '/src/modulo/adquisiciones/adquisiciones/index.html', 'cart', 1, 1),
  ('adquisiciones_control_oc', 'Control de OC', 'Adquisiciones', '/src/modulo/adquisiciones/control-oc/index.html', 'clipboard', 2, 1),
  ('rrhh', 'RRHH', 'RRHH', '/src/modulo/rrhh/rrhh/index.html', 'users', 1, 1),
  ('rrhh_control_ventas_compartidas', 'Control de Compartidos', 'RRHH', '/src/modulo/rrhh/control-ventas-compartidas/index.html', 'handshake', 2, 1),
  ('rrhh_control_comisiones', 'Control de Comisiones', 'RRHH', '/src/modulo/rrhh/control-comisiones/index.html', 'coins', 3, 1)
ON DUPLICATE KEY UPDATE
  nombre = VALUES(nombre),
  grupo = VALUES(grupo),
  url = VALUES(url),
  icono = VALUES(icono),
  orden = VALUES(orden),
  activo = VALUES(activo);

INSERT INTO perfil_menu (perfil_id, menu_id, activo)
SELECT p.id, m.id, 1
FROM perfil p
INNER JOIN menu m ON m.codigo IN (
  'cobranza',
  'cobranza_control_notas_venta',
  'cobranza_control_clientes'
)
WHERE p.codigo IN ('cobranza', 'contabilidad', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  activo = VALUES(activo);

INSERT INTO perfil_menu (perfil_id, menu_id, activo)
SELECT p.id, m.id, 1
FROM perfil p
INNER JOIN menu m ON m.codigo IN (
  'adquisiciones',
  'adquisiciones_control_oc'
)
WHERE p.codigo IN ('adquisiciones', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  activo = VALUES(activo);

INSERT INTO perfil_menu (perfil_id, menu_id, activo)
SELECT p.id, m.id, 1
FROM perfil p
INNER JOIN menu m ON m.codigo IN (
  'rrhh',
  'rrhh_control_ventas_compartidas',
  'rrhh_control_comisiones'
)
WHERE p.codigo IN ('rrhh', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  activo = VALUES(activo);
