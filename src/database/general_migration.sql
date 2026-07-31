-- Migracion idempotente para el modulo General.
-- Crea el menu General y lo asigna a todos los perfiles base.

INSERT INTO `menu` (`codigo`, `nombre`, `grupo`, `url`, `icono`, `orden`, `activo`)
VALUES
('general', 'General', 'General', '/src/modulo/general/general/index.html', '🧭', 0, 1)
ON DUPLICATE KEY UPDATE
  `nombre` = VALUES(`nombre`),
  `grupo` = VALUES(`grupo`),
  `url` = VALUES(`url`),
  `icono` = VALUES(`icono`),
  `orden` = VALUES(`orden`),
  `activo` = VALUES(`activo`);

INSERT INTO `perfil` (`codigo`, `nombre`, `descripcion`, `area`, `es_base`, `activo`)
VALUES
('general', 'General', 'Perfil base de acceso general', 'general', 1, 1)
ON DUPLICATE KEY UPDATE
  `nombre` = VALUES(`nombre`),
  `descripcion` = VALUES(`descripcion`),
  `area` = VALUES(`area`),
  `es_base` = VALUES(`es_base`),
  `activo` = VALUES(`activo`);

INSERT INTO `perfil_menu` (`perfil_id`, `menu_id`, `activo`)
SELECT p.`id`, m.`id`, 1
FROM `perfil` p
INNER JOIN `menu` m ON m.`codigo` = 'general'
WHERE p.`es_base` = 1
ON DUPLICATE KEY UPDATE
  `activo` = VALUES(`activo`);

INSERT INTO `usuario_perfil` (`usuario_id`, `perfil_id`, `activo`)
SELECT u.`id`, p.`id`, 1
FROM `usuario` u
INNER JOIN `perfil` p
  ON LOWER(TRIM(COALESCE(u.`area`, ''))) = 'general'
 AND p.`codigo` = 'general'
WHERE p.`es_base` = 1
ON DUPLICATE KEY UPDATE
  `activo` = VALUES(`activo`);
