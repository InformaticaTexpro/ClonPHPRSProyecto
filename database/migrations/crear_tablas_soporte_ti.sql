-- =============================================================================
-- Migración: módulo Soporte TI
-- Base de datos: bdtexpro
-- Ejecutar una sola vez en el servidor MySQL principal
-- =============================================================================

CREATE TABLE IF NOT EXISTS `ti_estandar_config` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `clave` VARCHAR(80) NOT NULL,
  `valor_texto` VARCHAR(255) DEFAULT NULL,
  `valor_numero` DECIMAL(14,2) DEFAULT NULL,
  `descripcion` VARCHAR(255) NOT NULL DEFAULT '',
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ti_estandar_config_clave` (`clave`),
  KEY `idx_ti_estandar_config_activo` (`activo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ti_equipo` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `codigo_equipo` VARCHAR(80) NOT NULL,
  `tipo_equipo` VARCHAR(120) NOT NULL DEFAULT '',
  `area` VARCHAR(120) NOT NULL DEFAULT '',
  `usuario_asignado` VARCHAR(160) NOT NULL DEFAULT '',
  `rol_equipo` VARCHAR(120) NOT NULL DEFAULT '',
  `ip_actual` VARCHAR(45) NOT NULL DEFAULT '',
  `estado` ENUM('ACTIVO','BAJA','MANTENCION','RESERVA','REVISAR') NOT NULL DEFAULT 'ACTIVO',
  `fecha_alta` DATE DEFAULT NULL,
  `fecha_baja` DATE DEFAULT NULL,
  `licencias` TEXT DEFAULT NULL,
  `accesos_ip` TEXT DEFAULT NULL,
  `observaciones` TEXT DEFAULT NULL,
  `creado_por` BIGINT DEFAULT NULL,
  `actualizado_por` BIGINT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ti_equipo_codigo` (`codigo_equipo`),
  KEY `idx_ti_equipo_estado` (`estado`),
  KEY `idx_ti_equipo_area` (`area`),
  KEY `idx_ti_equipo_usuario` (`usuario_asignado`),
  CONSTRAINT `fk_ti_equipo_creado_por`
    FOREIGN KEY (`creado_por`) REFERENCES `usuario` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT `fk_ti_equipo_actualizado_por`
    FOREIGN KEY (`actualizado_por`) REFERENCES `usuario` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ti_equipo_hardware` (
  `equipo_id` BIGINT NOT NULL,
  `generacion_procesador` VARCHAR(120) DEFAULT NULL,
  `descripcion_procesador` VARCHAR(255) DEFAULT NULL,
  `ram_gb` DECIMAL(10,2) DEFAULT NULL,
  `generacion_ram` VARCHAR(120) DEFAULT NULL,
  `tipo_equipo_fisico` VARCHAR(120) DEFAULT NULL,
  `almacenamiento_principal` VARCHAR(255) DEFAULT NULL,
  `almacenamiento_secundario` VARCHAR(255) DEFAULT NULL,
  `estado_disco` VARCHAR(120) DEFAULT NULL,
  `placa_madre` VARCHAR(255) DEFAULT NULL,
  `red` VARCHAR(120) DEFAULT NULL,
  `wifi` VARCHAR(120) DEFAULT NULL,
  `sistema_operativo` VARCHAR(160) DEFAULT NULL,
  `licencia_so` VARCHAR(255) DEFAULT NULL,
  `observaciones` TEXT DEFAULT NULL,
  `creado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`equipo_id`),
  CONSTRAINT `fk_ti_equipo_hardware_equipo`
    FOREIGN KEY (`equipo_id`) REFERENCES `ti_equipo` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ti_equipo_seguridad` (
  `equipo_id` BIGINT NOT NULL,
  `tipo_cuenta` VARCHAR(120) DEFAULT NULL,
  `antivirus` VARCHAR(160) DEFAULT NULL,
  `antivirus_activo` TINYINT(1) DEFAULT NULL,
  `firewall` TINYINT(1) DEFAULT NULL,
  `ultima_actualizacion_so` DATE DEFAULT NULL,
  `estado_seguridad` VARCHAR(120) DEFAULT NULL,
  `observaciones` TEXT DEFAULT NULL,
  `creado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`equipo_id`),
  CONSTRAINT `fk_ti_equipo_seguridad_equipo`
    FOREIGN KEY (`equipo_id`) REFERENCES `ti_equipo` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ti_equipo_credencial` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `equipo_id` BIGINT NOT NULL,
  `tipo` VARCHAR(50) NOT NULL DEFAULT 'LOCAL',
  `usuario` VARCHAR(150) DEFAULT NULL,
  `valor_cifrado` MEDIUMTEXT NOT NULL,
  `descripcion` VARCHAR(255) DEFAULT NULL,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `creado_por` BIGINT DEFAULT NULL,
  `actualizado_por` BIGINT DEFAULT NULL,
  `creado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ti_equipo_credencial_equipo` (`equipo_id`),
  UNIQUE KEY `uq_ti_equipo_credencial_equipo` (`equipo_id`),
  CONSTRAINT `fk_ti_equipo_credencial_equipo`
    FOREIGN KEY (`equipo_id`) REFERENCES `ti_equipo` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT `fk_ti_equipo_credencial_creado_por`
    FOREIGN KEY (`creado_por`) REFERENCES `usuario` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT `fk_ti_equipo_credencial_actualizado_por`
    FOREIGN KEY (`actualizado_por`) REFERENCES `usuario` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ti_equipo_historial` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `equipo_id` BIGINT NOT NULL,
  `accion` VARCHAR(80) NOT NULL,
  `detalle` LONGTEXT DEFAULT NULL,
  `usuario_id` BIGINT DEFAULT NULL,
  `usuario_nombre` VARCHAR(160) NOT NULL DEFAULT '',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ti_equipo_historial_equipo` (`equipo_id`),
  KEY `idx_ti_equipo_historial_accion` (`accion`),
  KEY `idx_ti_equipo_historial_fecha` (`created_at`),
  CONSTRAINT `fk_ti_equipo_historial_equipo`
    FOREIGN KEY (`equipo_id`) REFERENCES `ti_equipo` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT `fk_ti_equipo_historial_usuario`
    FOREIGN KEY (`usuario_id`) REFERENCES `usuario` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ti_mantencion` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `equipo_id` BIGINT NOT NULL,
  `tipo_mantencion` VARCHAR(120) NOT NULL DEFAULT '',
  `motivo` VARCHAR(255) DEFAULT NULL,
  `fecha_inicio` DATE DEFAULT NULL,
  `fecha_mantencion` DATE DEFAULT NULL,
  `tecnico_responsable` VARCHAR(160) DEFAULT NULL,
  `so_reinstalado` TINYINT(1) DEFAULT NULL,
  `drivers_ok` TINYINT(1) DEFAULT NULL,
  `disco_revisado` TINYINT(1) DEFAULT NULL,
  `resultado` VARCHAR(160) DEFAULT NULL,
  `mantencion` VARCHAR(160) DEFAULT NULL,
  `observaciones` TEXT DEFAULT NULL,
  `creado_por` BIGINT DEFAULT NULL,
  `actualizado_por` BIGINT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ti_mantencion_equipo` (`equipo_id`),
  KEY `idx_ti_mantencion_fecha` (`fecha_mantencion`),
  CONSTRAINT `fk_ti_mantencion_equipo`
    FOREIGN KEY (`equipo_id`) REFERENCES `ti_equipo` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT `fk_ti_mantencion_creado_por`
    FOREIGN KEY (`creado_por`) REFERENCES `usuario` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT `fk_ti_mantencion_actualizado_por`
    FOREIGN KEY (`actualizado_por`) REFERENCES `usuario` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ti_actividad` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `numero_solicitud` VARCHAR(40) DEFAULT NULL,
  `titulo` VARCHAR(200) NOT NULL,
  `descripcion` LONGTEXT DEFAULT NULL,
  `solicitante_nombre` VARCHAR(160) NOT NULL DEFAULT '',
  `solicitante_area` VARCHAR(120) NOT NULL DEFAULT '',
  `tipo` VARCHAR(120) NOT NULL DEFAULT '',
  `prioridad` ENUM('BAJA','MEDIA','ALTA','CRITICA') NOT NULL DEFAULT 'MEDIA',
  `estado` ENUM('PENDIENTE','EN_PROCESO','EN_ESPERA','FINALIZADA','CANCELADA') NOT NULL DEFAULT 'PENDIENTE',
  `fecha_solicitud` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `fecha_objetivo` DATETIME DEFAULT NULL,
  `fecha_inicio` DATETIME DEFAULT NULL,
  `fecha_cierre` DATETIME DEFAULT NULL,
  `responsable_usuario_id` BIGINT DEFAULT NULL,
  `responsable_nombre` VARCHAR(160) NOT NULL DEFAULT '',
  `equipo_id` BIGINT DEFAULT NULL,
  `observaciones` LONGTEXT DEFAULT NULL,
  `creado_por` BIGINT DEFAULT NULL,
  `actualizado_por` BIGINT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ti_actividad_numero` (`numero_solicitud`),
  KEY `idx_ti_actividad_estado` (`estado`),
  KEY `idx_ti_actividad_prioridad` (`prioridad`),
  KEY `idx_ti_actividad_fecha` (`fecha_solicitud`),
  KEY `idx_ti_actividad_equipo` (`equipo_id`),
  CONSTRAINT `fk_ti_actividad_responsable_usuario`
    FOREIGN KEY (`responsable_usuario_id`) REFERENCES `usuario` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT `fk_ti_actividad_equipo`
    FOREIGN KEY (`equipo_id`) REFERENCES `ti_equipo` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT `fk_ti_actividad_creado_por`
    FOREIGN KEY (`creado_por`) REFERENCES `usuario` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT `fk_ti_actividad_actualizado_por`
    FOREIGN KEY (`actualizado_por`) REFERENCES `usuario` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ti_actividad_historial` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `actividad_id` BIGINT NOT NULL,
  `accion` VARCHAR(80) NOT NULL,
  `detalle` LONGTEXT DEFAULT NULL,
  `usuario_id` BIGINT DEFAULT NULL,
  `usuario_nombre` VARCHAR(160) NOT NULL DEFAULT '',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ti_actividad_historial_actividad` (`actividad_id`),
  KEY `idx_ti_actividad_historial_accion` (`accion`),
  KEY `idx_ti_actividad_historial_fecha` (`created_at`),
  CONSTRAINT `fk_ti_actividad_historial_actividad`
    FOREIGN KEY (`actividad_id`) REFERENCES `ti_actividad` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT `fk_ti_actividad_historial_usuario`
    FOREIGN KEY (`usuario_id`) REFERENCES `usuario` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ti_actividad_comentario` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `actividad_id` BIGINT NOT NULL,
  `comentario` LONGTEXT NOT NULL,
  `usuario_id` BIGINT DEFAULT NULL,
  `usuario_nombre` VARCHAR(160) NOT NULL DEFAULT '',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ti_actividad_comentario_actividad` (`actividad_id`),
  KEY `idx_ti_actividad_comentario_fecha` (`created_at`),
  CONSTRAINT `fk_ti_actividad_comentario_actividad`
    FOREIGN KEY (`actividad_id`) REFERENCES `ti_actividad` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT `fk_ti_actividad_comentario_usuario`
    FOREIGN KEY (`usuario_id`) REFERENCES `usuario` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ti_bodega_producto` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `codigo_producto` VARCHAR(80) NOT NULL,
  `categoria` VARCHAR(120) NOT NULL DEFAULT '',
  `descripcion` VARCHAR(255) NOT NULL DEFAULT '',
  `stock_inicial` INT NOT NULL DEFAULT 0,
  `stock_minimo` INT NOT NULL DEFAULT 0,
  `ubicacion` VARCHAR(160) DEFAULT NULL,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `creado_por` BIGINT DEFAULT NULL,
  `actualizado_por` BIGINT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ti_bodega_producto_codigo` (`codigo_producto`),
  KEY `idx_ti_bodega_producto_categoria` (`categoria`),
  KEY `idx_ti_bodega_producto_activo` (`activo`),
  CONSTRAINT `fk_ti_bodega_producto_creado_por`
    FOREIGN KEY (`creado_por`) REFERENCES `usuario` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT `fk_ti_bodega_producto_actualizado_por`
    FOREIGN KEY (`actualizado_por`) REFERENCES `usuario` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `ti_bodega_movimiento` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `producto_id` BIGINT NOT NULL,
  `tipo_movimiento` ENUM('ENTRADA','SALIDA','AJUSTE_POSITIVO','AJUSTE_NEGATIVO') NOT NULL,
  `cantidad` INT NOT NULL DEFAULT 0,
  `motivo` VARCHAR(255) DEFAULT NULL,
  `equipo_id` BIGINT DEFAULT NULL,
  `actividad_id` BIGINT DEFAULT NULL,
  `entregado_a` VARCHAR(160) DEFAULT NULL,
  `usuario_id` BIGINT DEFAULT NULL,
  `usuario_nombre` VARCHAR(160) NOT NULL DEFAULT '',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ti_bodega_movimiento_producto` (`producto_id`),
  KEY `idx_ti_bodega_movimiento_tipo` (`tipo_movimiento`),
  KEY `idx_ti_bodega_movimiento_equipo` (`equipo_id`),
  KEY `idx_ti_bodega_movimiento_actividad` (`actividad_id`),
  KEY `idx_ti_bodega_movimiento_fecha` (`created_at`),
  CONSTRAINT `fk_ti_bodega_movimiento_producto`
    FOREIGN KEY (`producto_id`) REFERENCES `ti_bodega_producto` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT `fk_ti_bodega_movimiento_equipo`
    FOREIGN KEY (`equipo_id`) REFERENCES `ti_equipo` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT `fk_ti_bodega_movimiento_actividad`
    FOREIGN KEY (`actividad_id`) REFERENCES `ti_actividad` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT `fk_ti_bodega_movimiento_usuario`
    FOREIGN KEY (`usuario_id`) REFERENCES `usuario` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `ti_estandar_config` (`clave`, `valor_texto`, `valor_numero`, `descripcion`, `activo`)
VALUES
('cpu_minimo_texto', 'Intel Core i5', NULL, 'Texto de referencia para el CPU mÃ­nimo', 1),
('ram_minima_gb', NULL, 16, 'RAM mÃ­nima requerida para cumplimiento', 1)
ON DUPLICATE KEY UPDATE
  `valor_texto` = VALUES(`valor_texto`),
  `valor_numero` = VALUES(`valor_numero`),
  `descripcion` = VALUES(`descripcion`),
  `activo` = VALUES(`activo`);

INSERT INTO `menu` (`codigo`, `nombre`, `grupo`, `url`, `icono`, `orden`, `activo`)
VALUES
('soporte_ti_dashboard', 'Dashboard', 'Soporte TI', '/src/modulo/soporte-ti/dashboard/index.html', 'dashboard', 1, 1),
('soporte_ti_equipos', 'Equipos', 'Soporte TI', '/src/modulo/soporte-ti/equipos/index.html', 'monitor', 2, 1),
('soporte_ti_actividades', 'Actividades', 'Soporte TI', '/src/modulo/soporte-ti/actividades/index.html', 'clipboard', 3, 1),
('soporte_ti_mantenciones', 'Mantenciones', 'Soporte TI', '/src/modulo/soporte-ti/mantenciones/index.html', 'tools', 4, 1),
('soporte_ti_bodega', 'Bodega TI', 'Soporte TI', '/src/modulo/soporte-ti/bodega/index.html', 'boxes', 5, 1)
ON DUPLICATE KEY UPDATE
  `nombre` = VALUES(`nombre`),
  `grupo` = VALUES(`grupo`),
  `url` = VALUES(`url`),
  `icono` = VALUES(`icono`),
  `orden` = VALUES(`orden`),
  `activo` = VALUES(`activo`);

INSERT INTO `perfil` (`codigo`, `nombre`, `descripcion`, `area`, `es_base`, `activo`)
VALUES
('soporte-ti', 'Soporte TI', 'Perfil base para Soporte TI', 'soporte-ti', 1, 1)
ON DUPLICATE KEY UPDATE
  `nombre` = VALUES(`nombre`),
  `descripcion` = VALUES(`descripcion`),
  `area` = VALUES(`area`),
  `es_base` = VALUES(`es_base`),
  `activo` = VALUES(`activo`);

INSERT INTO `perfil_menu` (`perfil_id`, `menu_id`, `activo`)
SELECT p.`id`, m.`id`, 1
FROM `perfil` p
INNER JOIN `menu` m ON m.`codigo` = 'soporte_ti_dashboard'
WHERE p.`codigo` IN ('soporte-ti', 'gerencia', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  `activo` = VALUES(`activo`);

INSERT INTO `perfil_menu` (`perfil_id`, `menu_id`, `activo`)
SELECT p.`id`, m.`id`, 1
FROM `perfil` p
INNER JOIN `menu` m ON m.`codigo` = 'soporte_ti_equipos'
WHERE p.`codigo` IN ('soporte-ti', 'gerencia', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  `activo` = VALUES(`activo`);

INSERT INTO `perfil_menu` (`perfil_id`, `menu_id`, `activo`)
SELECT p.`id`, m.`id`, 1
FROM `perfil` p
INNER JOIN `menu` m ON m.`codigo` = 'soporte_ti_actividades'
WHERE p.`codigo` IN ('soporte-ti', 'gerencia', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  `activo` = VALUES(`activo`);

INSERT INTO `perfil_menu` (`perfil_id`, `menu_id`, `activo`)
SELECT p.`id`, m.`id`, 1
FROM `perfil` p
INNER JOIN `menu` m ON m.`codigo` = 'soporte_ti_mantenciones'
WHERE p.`codigo` IN ('soporte-ti', 'gerencia', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  `activo` = VALUES(`activo`);

INSERT INTO `perfil_menu` (`perfil_id`, `menu_id`, `activo`)
SELECT p.`id`, m.`id`, 1
FROM `perfil` p
INNER JOIN `menu` m ON m.`codigo` = 'soporte_ti_bodega'
WHERE p.`codigo` IN ('soporte-ti', 'gerencia', 'administracion', 'admin')
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
