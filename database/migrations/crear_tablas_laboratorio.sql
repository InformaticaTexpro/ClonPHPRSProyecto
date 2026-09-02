-- =============================================================================
-- Migración: módulo de laboratorio / ingreso de muestras
-- Ejecutar una sola vez en la base MySQL principal
-- =============================================================================

CREATE TABLE IF NOT EXISTS `laboratorio_parametro` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(160) NOT NULL,
  `valor_ensayo` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `creado_por` BIGINT DEFAULT NULL,
  `actualizado_por` BIGINT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_laboratorio_parametro_nombre` (`nombre`),
  KEY `idx_laboratorio_parametro_activo` (`activo`),
  KEY `idx_laboratorio_parametro_nombre` (`nombre`),
  CONSTRAINT `fk_laboratorio_parametro_creado_por`
    FOREIGN KEY (`creado_por`) REFERENCES `usuario` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT `fk_laboratorio_parametro_actualizado_por`
    FOREIGN KEY (`actualizado_por`) REFERENCES `usuario` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `laboratorio_solicitud` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `numero_solicitud` VARCHAR(80) NOT NULL,
  `fecha_ingreso` DATE NOT NULL,
  `vendedor_nombre` VARCHAR(160) NOT NULL,
  `vendedor_codigo` VARCHAR(20) DEFAULT NULL,
  `numero_muestras` INT NOT NULL DEFAULT 1,
  `valor_unitario` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `total` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `estado` ENUM('INGRESADA','EN_PROCESO','FINALIZADA','ANULADA') NOT NULL DEFAULT 'INGRESADA',
  `registrado_por` BIGINT DEFAULT NULL,
  `registrado_por_nombre` VARCHAR(160) NOT NULL,
  `observacion` TEXT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_laboratorio_solicitud_numero` (`numero_solicitud`),
  KEY `idx_laboratorio_solicitud_fecha` (`fecha_ingreso`),
  KEY `idx_laboratorio_solicitud_estado` (`estado`),
  KEY `idx_laboratorio_solicitud_vendedor` (`vendedor_codigo`),
  KEY `idx_laboratorio_solicitud_registrado` (`registrado_por`),
  CONSTRAINT `fk_laboratorio_solicitud_registrado_por`
    FOREIGN KEY (`registrado_por`) REFERENCES `usuario` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `laboratorio_solicitud_parametro` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `solicitud_id` BIGINT NOT NULL,
  `parametro_id` BIGINT DEFAULT NULL,
  `parametro_nombre` VARCHAR(160) NOT NULL,
  `valor_ensayo` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `cantidad_muestras` INT NOT NULL DEFAULT 1,
  `subtotal` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_laboratorio_solicitud_parametro_solicitud` (`solicitud_id`),
  KEY `idx_laboratorio_solicitud_parametro_parametro` (`parametro_id`),
  CONSTRAINT `fk_laboratorio_solicitud_parametro_solicitud`
    FOREIGN KEY (`solicitud_id`) REFERENCES `laboratorio_solicitud` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT `fk_laboratorio_solicitud_parametro_parametro`
    FOREIGN KEY (`parametro_id`) REFERENCES `laboratorio_parametro` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `laboratorio_auditoria` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `usuario_id` BIGINT DEFAULT NULL,
  `usuario_nombre` VARCHAR(160) NOT NULL,
  `accion` VARCHAR(80) NOT NULL,
  `entidad` VARCHAR(80) NOT NULL,
  `entidad_id` BIGINT DEFAULT NULL,
  `detalle` LONGTEXT,
  `creado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_laboratorio_auditoria_entidad` (`entidad`, `entidad_id`),
  KEY `idx_laboratorio_auditoria_accion` (`accion`),
  KEY `idx_laboratorio_auditoria_usuario` (`usuario_id`),
  KEY `idx_laboratorio_auditoria_fecha` (`creado_en`),
  CONSTRAINT `fk_laboratorio_auditoria_usuario`
    FOREIGN KEY (`usuario_id`) REFERENCES `usuario` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `menu` (`codigo`, `nombre`, `grupo`, `url`, `icono`, `orden`, `activo`)
VALUES
('laboratorio_ingreso_muestras', 'Ingreso de Muestras', 'Laboratorio', '/src/modulo/laboratorio/ingreso-muestras/index.html', '🧪', 1, 1)
ON DUPLICATE KEY UPDATE
  `nombre` = VALUES(`nombre`),
  `grupo` = VALUES(`grupo`),
  `url` = VALUES(`url`),
  `icono` = VALUES(`icono`),
  `orden` = VALUES(`orden`),
  `activo` = VALUES(`activo`);

INSERT INTO `perfil`
(`codigo`, `nombre`, `descripcion`, `area`, `es_base`, `activo`)
VALUES
('laboratorio', 'Laboratorio', 'Perfil base para laboratorio', 'laboratorio', 1, 1)
ON DUPLICATE KEY UPDATE
  `nombre` = VALUES(`nombre`),
  `descripcion` = VALUES(`descripcion`),
  `area` = VALUES(`area`),
  `es_base` = VALUES(`es_base`),
  `activo` = VALUES(`activo`);

INSERT INTO `perfil_menu` (`perfil_id`, `menu_id`, `activo`)
SELECT p.`id`, m.`id`, 1
FROM `perfil` p
INNER JOIN `menu` m ON m.`codigo` = 'laboratorio_ingreso_muestras'
WHERE p.`codigo` IN ('laboratorio', 'gerencia', 'administracion', 'admin')
ON DUPLICATE KEY UPDATE
  `activo` = VALUES(`activo`);
