-- Migración idempotente para registrar submenús derivados en la tabla menu.
-- Permite gestionarlos desde Administración en vez de depender solo del sidebar.

INSERT INTO menu (codigo, nombre, grupo, url, icono, orden, activo)
VALUES
  (
    'gerencia_ventas_vendedor',
    'Ventas por Vendedor',
    'Gerencia',
    '/src/modulo/gerencia/comercial/ventas-vendedor/index.html',
    'chart',
    3,
    1
  ),
  (
    'gerencia_control_muestras',
    'Control de Muestras',
    'Gerencia',
    '/src/modulo/gerencia/comercial/control-muestras/index.html',
    'flask',
    4,
    1
  ),
  (
    'gerencia_concurso_ventas',
    'Concurso de Ventas 2026',
    'Gerencia',
    '/src/modulo/gerencia/comercial/concurso-ventas/2026/index.html',
    'trophy',
    5,
    1
  ),
  (
    'administracion_concurso_ventas',
    'Concurso de Ventas 2026',
    'Administración',
    '/src/modulo/admin/concurso-ventas/2026/index.html',
    'trophy',
    99,
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
INNER JOIN menu m ON m.codigo IN (
  'gerencia_ventas_vendedor',
  'gerencia_control_muestras',
  'gerencia_concurso_ventas'
)
WHERE p.codigo IN ('gerencia', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  activo = VALUES(activo);

INSERT INTO perfil_menu (perfil_id, menu_id, activo)
SELECT p.id, m.id, 1
FROM perfil p
INNER JOIN menu m ON m.codigo = 'administracion_concurso_ventas'
WHERE p.codigo IN ('administracion', 'admin')
ON DUPLICATE KEY UPDATE
  activo = VALUES(activo);
