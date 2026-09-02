-- Migración idempotente para registrar el menú de cotizaciones
-- y asignarlo a los perfiles autorizados.

INSERT INTO menu (codigo, nombre, grupo, url, icono, orden, activo)
VALUES (
  'ventas_cotizaciones',
  'Cotizaciones',
  'Ventas',
  '/src/modulo/ventas/cotizaciones/index.html',
  '💼',
  8,
  1
)
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
INNER JOIN menu m ON m.codigo = 'ventas_cotizaciones'
WHERE p.codigo IN ('ventas', 'gerencia', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  activo = VALUES(activo);
