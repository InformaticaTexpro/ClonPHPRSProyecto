-- Migración idempotente para menús de RRHH.
-- La tabla de reportes compartidos se define en la migración de reportes compartidos.


INSERT INTO menu (codigo, nombre, url, icono, grupo, orden, activo)
SELECT
  'rrhh',
  'RRHH',
  '/src/modulo/rrhh/rrhh/index.html',
  '👥',
  'RRHH',
  1,
  1
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1
  FROM menu
  WHERE codigo = 'rrhh'
);

UPDATE menu
SET nombre = 'RRHH',
    url = '/src/modulo/rrhh/rrhh/index.html',
    icono = '👥',
    grupo = 'RRHH',
    orden = 1,
    activo = 1
WHERE codigo = 'rrhh';

INSERT INTO menu (codigo, nombre, url, icono, grupo, orden, activo)
SELECT
  'rrhh_reportes_compartidos',
  'Reportes ventas compartidas',
  '/src/modulo/rrhh/reportes-compartidos/index.html',
  '📄',
  'RRHH',
  2,
  1
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1
  FROM menu
  WHERE codigo = 'rrhh_reportes_compartidos'
);

UPDATE menu
SET nombre = 'Reportes ventas compartidas',
    url = '/src/modulo/rrhh/reportes-compartidos/index.html',
    icono = '📄',
    grupo = 'RRHH',
    orden = 2,
    activo = 1
WHERE codigo = 'rrhh_reportes_compartidos';

INSERT INTO perfil_menu (perfil_id, menu_id, activo)
SELECT p.id, m.id, 1
FROM perfil p
INNER JOIN menu m ON m.codigo IN ('rrhh', 'rrhh_reportes_compartidos')
WHERE p.codigo IN ('rrhh', 'administracion', 'admin')
  AND NOT EXISTS (
    SELECT 1
    FROM perfil_menu pm
    WHERE pm.perfil_id = p.id
      AND pm.menu_id = m.id
  );

INSERT INTO usuario_menu (usuario_id, menu_id, activo)
SELECT u.id, m.id, 1
FROM usuario u
INNER JOIN menu m ON m.codigo IN ('rrhh', 'rrhh_reportes_compartidos')
WHERE (LOWER(TRIM(u.area)) = 'rrhh'
   OR u.is_admin = 1)
  AND NOT EXISTS (
    SELECT 1
    FROM usuario_menu um
    WHERE um.usuario_id = u.id
      AND um.menu_id = m.id
  );
