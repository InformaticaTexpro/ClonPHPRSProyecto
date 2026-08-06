-- =============================================================================
-- Migración: tablas del módulo de Administración
-- Base de datos: bdtexpro
-- Ejecutar una sola vez en el servidor de base de datos
-- =============================================================================

CREATE TABLE IF NOT EXISTS `menu` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `codigo` VARCHAR(80) NOT NULL,
  `nombre` VARCHAR(120) NOT NULL,
  `url` VARCHAR(255) NOT NULL,
  `icono` VARCHAR(50) DEFAULT '',
  `grupo` VARCHAR(100) NOT NULL DEFAULT 'General',
  `orden` INT NOT NULL DEFAULT 0,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_menu_codigo` (`codigo`),
  KEY `idx_menu_activo_orden` (`activo`, `orden`),
  KEY `idx_menu_grupo` (`grupo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `perfil` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `codigo` VARCHAR(80) NOT NULL,
  `nombre` VARCHAR(120) NOT NULL,
  `descripcion` VARCHAR(255) NOT NULL DEFAULT '',
  `area` VARCHAR(80) NOT NULL DEFAULT '',
  `es_base` TINYINT(1) NOT NULL DEFAULT 0,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_perfil_codigo` (`codigo`),
  KEY `idx_perfil_area_base` (`area`, `es_base`),
  KEY `idx_perfil_activo` (`activo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `usuario_menu` (
  `usuario_id` BIGINT NOT NULL,
  `menu_id` BIGINT NOT NULL,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`usuario_id`, `menu_id`),
  KEY `idx_usuario_menu_menu` (`menu_id`),
  KEY `idx_usuario_menu_activo` (`activo`),
  CONSTRAINT `fk_usuario_menu_usuario`
    FOREIGN KEY (`usuario_id`) REFERENCES `usuario` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT `fk_usuario_menu_menu`
    FOREIGN KEY (`menu_id`) REFERENCES `menu` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `perfil_menu` (
  `perfil_id` BIGINT NOT NULL,
  `menu_id` BIGINT NOT NULL,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`perfil_id`, `menu_id`),
  KEY `idx_perfil_menu_menu` (`menu_id`),
  KEY `idx_perfil_menu_activo` (`activo`),
  CONSTRAINT `fk_perfil_menu_perfil`
    FOREIGN KEY (`perfil_id`) REFERENCES `perfil` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT `fk_perfil_menu_menu`
    FOREIGN KEY (`menu_id`) REFERENCES `menu` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `usuario_perfil` (
  `usuario_id` BIGINT NOT NULL,
  `perfil_id` BIGINT NOT NULL,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`usuario_id`, `perfil_id`),
  KEY `idx_usuario_perfil_perfil` (`perfil_id`),
  KEY `idx_usuario_perfil_activo` (`activo`),
  CONSTRAINT `fk_usuario_perfil_usuario`
    FOREIGN KEY (`usuario_id`) REFERENCES `usuario` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT `fk_usuario_perfil_perfil`
    FOREIGN KEY (`perfil_id`) REFERENCES `perfil` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `menu` (`id`, `codigo`, `nombre`, `grupo`, `url`, `icono`, `orden`, `activo`)
VALUES
(1,  'ventas_dashboard',  'Dashboard',         'Ventas',           '/src/modulo/ventas/dashboard/index.html',             '🏠', 1, 1),
(2,  'ventas_asignadas',  'Ventas Asignadas',  'Ventas',           '/src/modulo/ventas/ventas/index.html',                '🤝', 2, 1),
(3,  'historial_cliente', 'Historial Cliente', 'Ventas',           '/src/modulo/ventas/historial-cliente/index.html',     '📋', 3, 1),
(4,  'produccion',        'Producción',        'Producción',       '/src/modulo/produccion/produccion/index.html',        '⚙️', 1, 1),
(5,  'bodega',            'Bodega',            'Bodega',           '/src/modulo/bodega/bodega/index.html',                '🏭', 1, 1),
(6,  'servicio_tecnico',  'Servicio Técnico',  'Servicio Técnico', '/src/modulo/servtecnico/servicio-tecnico/index.html', '🛠️', 1, 1),
(7,  'facturacion',       'Facturación',       'Facturación',      '/src/modulo/facturacion/facturacion/index.html',      '🧾', 1, 1),
(8,  'rrhh',              'RRHH',              'General',          '/src/modulo/rrhh/rrhh/index.html',                    '👥', 1, 1),
(9,  'contabilidad',      'Contabilidad',      'Contabilidad',     '/src/modulo/contabilidad/contabilidad/index.html',    '📜', 1, 1),
(10, 'cobranza',          'Cobranza',          'Contabilidad',     '/src/modulo/cobranza/cobranza/index.html',            '💰', 2, 1),
(11, 'administracion',    'Administración',    'Administración',   '/src/modulo/admin/admin/index.html',                  '🔧', 1, 1),
(12, 'alertas',           'Alertas',           'General',          '/src/modulo/varios/alertas/index.html',               '🔔', 1, 1),
(13, 'mensajeria',        'Chat',              'General',          '/src/modulo/varios/mensajeria/index.html',            '💬', 2, 1),
(14, 'gerencia',          'Dashboard Comercial', 'Gerencia',         '/src/modulo/gerencia/dashboard-comercial/index.html',  '📈', 1, 1),
(15, 'gerencia_estadisticas_ventas', 'Estadísticas de Ventas', 'Gerencia', '/src/modulo/gerencia/comercial/estadisticas-ventas/index.html', '📊', 2, 1),
(16, 'gerencia_dashboard_finanzas', 'Dashboard Finanzas', 'Gerencia', '/src/modulo/gerencia/comercial/dashboard-finanzas/index.html', '💳', 3, 1)
ON DUPLICATE KEY UPDATE
  `nombre` = VALUES(`nombre`),
  `grupo` = VALUES(`grupo`),
  `url` = VALUES(`url`),
  `icono` = VALUES(`icono`),
  `orden` = VALUES(`orden`),
  `activo` = VALUES(`activo`);

INSERT INTO `perfil` (`codigo`, `nombre`, `descripcion`, `area`, `es_base`, `activo`)
VALUES
('ventas', 'Ventas', 'Perfil base para el equipo de ventas', 'ventas', 1, 1),
('produccion', 'Producción', 'Perfil base para el equipo de producción', 'produccion', 1, 1),
('bodega', 'Bodega', 'Perfil base para el equipo de bodega', 'bodega', 1, 1),
('servicio-tecnico', 'Servicio Técnico', 'Perfil base para servicio técnico', 'servicio-tecnico', 1, 1),
('facturacion', 'Facturación', 'Perfil base para facturación', 'facturacion', 1, 1),
('contabilidad', 'Contabilidad', 'Perfil base para contabilidad y cobranza', 'contabilidad', 1, 1),
('rrhh', 'RRHH', 'Perfil base para recursos humanos', 'rrhh', 1, 1),
('gerencia', 'Gerencia', 'Perfil base para gerencia', 'gerencia', 1, 1),
('administracion', 'Administración', 'Perfil base para administración', 'administracion', 1, 1),
('admin', 'Administración', 'Perfil base de compatibilidad para administración', 'admin', 1, 1)
ON DUPLICATE KEY UPDATE
  `nombre` = VALUES(`nombre`),
  `descripcion` = VALUES(`descripcion`),
  `area` = VALUES(`area`),
  `es_base` = VALUES(`es_base`),
  `activo` = VALUES(`activo`);

INSERT INTO `perfil_menu` (`perfil_id`, `menu_id`, `activo`)
SELECT p.`id`, m.`id`, 1
FROM `perfil` p
INNER JOIN `menu` m ON m.`codigo` = 'ventas_dashboard'
WHERE p.`codigo` IN ('ventas', 'gerencia', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  `activo` = VALUES(`activo`);

INSERT INTO `perfil_menu` (`perfil_id`, `menu_id`, `activo`)
SELECT p.`id`, m.`id`, 1
FROM `perfil` p
INNER JOIN `menu` m ON m.`codigo` = 'ventas_asignadas'
WHERE p.`codigo` IN ('ventas', 'gerencia', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  `activo` = VALUES(`activo`);

INSERT INTO `perfil_menu` (`perfil_id`, `menu_id`, `activo`)
SELECT p.`id`, m.`id`, 1
FROM `perfil` p
INNER JOIN `menu` m ON m.`codigo` = 'historial_cliente'
WHERE p.`codigo` IN ('ventas', 'gerencia', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  `activo` = VALUES(`activo`);

INSERT INTO `perfil_menu` (`perfil_id`, `menu_id`, `activo`)
SELECT p.`id`, m.`id`, 1
FROM `perfil` p
INNER JOIN `menu` m ON m.`codigo` = 'alertas'
WHERE p.`codigo` IN ('ventas', 'produccion', 'bodega', 'servicio-tecnico', 'facturacion', 'contabilidad', 'rrhh', 'gerencia', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  `activo` = VALUES(`activo`);

INSERT INTO `perfil_menu` (`perfil_id`, `menu_id`, `activo`)
SELECT p.`id`, m.`id`, 1
FROM `perfil` p
INNER JOIN `menu` m ON m.`codigo` = 'mensajeria'
WHERE p.`codigo` IN ('ventas', 'produccion', 'bodega', 'servicio-tecnico', 'facturacion', 'contabilidad', 'rrhh', 'gerencia', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  `activo` = VALUES(`activo`);

INSERT INTO `perfil_menu` (`perfil_id`, `menu_id`, `activo`)
SELECT p.`id`, m.`id`, 1
FROM `perfil` p
INNER JOIN `menu` m ON m.`codigo` = 'produccion'
WHERE p.`codigo` IN ('produccion', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  `activo` = VALUES(`activo`);

INSERT INTO `perfil_menu` (`perfil_id`, `menu_id`, `activo`)
SELECT p.`id`, m.`id`, 1
FROM `perfil` p
INNER JOIN `menu` m ON m.`codigo` = 'bodega'
WHERE p.`codigo` IN ('bodega', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  `activo` = VALUES(`activo`);

INSERT INTO `perfil_menu` (`perfil_id`, `menu_id`, `activo`)
SELECT p.`id`, m.`id`, 1
FROM `perfil` p
INNER JOIN `menu` m ON m.`codigo` = 'servicio_tecnico'
WHERE p.`codigo` IN ('servicio-tecnico', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  `activo` = VALUES(`activo`);

INSERT INTO `perfil_menu` (`perfil_id`, `menu_id`, `activo`)
SELECT p.`id`, m.`id`, 1
FROM `perfil` p
INNER JOIN `menu` m ON m.`codigo` = 'facturacion'
WHERE p.`codigo` IN ('facturacion', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  `activo` = VALUES(`activo`);

INSERT INTO `perfil_menu` (`perfil_id`, `menu_id`, `activo`)
SELECT p.`id`, m.`id`, 1
FROM `perfil` p
INNER JOIN `menu` m ON m.`codigo` = 'contabilidad'
WHERE p.`codigo` IN ('contabilidad', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  `activo` = VALUES(`activo`);

INSERT INTO `perfil_menu` (`perfil_id`, `menu_id`, `activo`)
SELECT p.`id`, m.`id`, 1
FROM `perfil` p
INNER JOIN `menu` m ON m.`codigo` = 'cobranza'
WHERE p.`codigo` IN ('contabilidad', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  `activo` = VALUES(`activo`);

INSERT INTO `perfil_menu` (`perfil_id`, `menu_id`, `activo`)
SELECT p.`id`, m.`id`, 1
FROM `perfil` p
INNER JOIN `menu` m ON m.`codigo` = 'administracion'
WHERE p.`codigo` IN ('administracion', 'admin')
ON DUPLICATE KEY UPDATE
  `activo` = VALUES(`activo`);

INSERT INTO `perfil_menu` (`perfil_id`, `menu_id`, `activo`)
SELECT p.`id`, m.`id`, 1
FROM `perfil` p
INNER JOIN `menu` m ON m.`codigo` = 'gerencia'
WHERE p.`codigo` IN ('gerencia', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  `activo` = VALUES(`activo`);

INSERT INTO `perfil_menu` (`perfil_id`, `menu_id`, `activo`)
SELECT p.`id`, m.`id`, 1
FROM `perfil` p
INNER JOIN `menu` m ON m.`codigo` = 'gerencia_estadisticas_ventas'
WHERE p.`codigo` IN ('gerencia', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  `activo` = VALUES(`activo`);

INSERT INTO `perfil_menu` (`perfil_id`, `menu_id`, `activo`)
SELECT p.`id`, m.`id`, 1
FROM `perfil` p
INNER JOIN `menu` m ON m.`codigo` = 'gerencia_dashboard_finanzas'
WHERE p.`codigo` IN ('gerencia', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  `activo` = VALUES(`activo`);

INSERT INTO `usuario_perfil` (`usuario_id`, `perfil_id`, `activo`)
SELECT u.`id`, p.`id`, 1
FROM `usuario` u
INNER JOIN `perfil` p
  ON LOWER(TRIM(COALESCE(u.`area`, ''))) = LOWER(TRIM(COALESCE(p.`area`, '')))
WHERE p.`es_base` = 1
ON DUPLICATE KEY UPDATE
  `activo` = VALUES(`activo`);
