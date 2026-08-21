-- Migración idempotente para registrar el menú de revisión de ventas compartidas
-- y asignarlo por perfil, sin usar extras hardcodeados en el frontend.

INSERT INTO menu (codigo, nombre, url, icono, grupo, orden, activo)
VALUES (
  'rrhh_reportes_compartidos',
  'Revisión ventas compartidas',
  '/src/modulo/rrhh/reportes-compartidos/index.html',
  'reportes',
  'RRHH',
  2,
  1
)
ON DUPLICATE KEY UPDATE
  nombre = VALUES(nombre),
  url = VALUES(url),
  icono = VALUES(icono),
  grupo = VALUES(grupo),
  orden = VALUES(orden),
  activo = VALUES(activo);

INSERT INTO perfil_menu (perfil_id, menu_id, activo)
SELECT p.id, m.id, 1
FROM perfil p
INNER JOIN menu m ON m.codigo = 'rrhh_reportes_compartidos'
WHERE p.codigo IN ('rrhh', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  activo = VALUES(activo);
