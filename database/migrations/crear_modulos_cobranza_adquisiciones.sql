-- Registra Cobranza y Adquisiciones como módulos principales independientes.
-- Idempotente: actualiza el catálogo si los códigos ya existen.
-- Acceso inicial: solo perfiles administracion y admin.

INSERT INTO menu (codigo, nombre, grupo, url, icono, orden, activo)
VALUES
  (
    'cobranza',
    'Cobranza',
    'Cobranza',
    '/src/modulo/cobranza/cobranza/index.html',
    'chart',
    1,
    1
  ),
  (
    'adquisiciones',
    'Adquisiciones',
    'Adquisiciones',
    '/src/modulo/adquisiciones/adquisiciones/index.html',
    'boxes',
    1,
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
INNER JOIN menu m ON m.codigo IN ('cobranza', 'adquisiciones')
WHERE p.codigo IN ('administracion', 'admin')
ON DUPLICATE KEY UPDATE
  activo = VALUES(activo);

UPDATE perfil_menu pm
INNER JOIN menu m ON m.id = pm.menu_id
INNER JOIN perfil p ON p.id = pm.perfil_id
SET pm.activo = 0
WHERE m.codigo IN ('cobranza', 'adquisiciones')
  AND p.codigo NOT IN ('administracion', 'admin');
