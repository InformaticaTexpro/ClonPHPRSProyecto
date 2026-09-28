-- =============================================================================
-- Migracion: dispositivos de impresion para Soporte TI
-- Base de datos: bdtexpro
-- Ejecutar una sola vez cuando se habilite la estructura en el entorno objetivo.
-- No incluye inserts ni modifica datos existentes.
-- =============================================================================

CREATE TABLE IF NOT EXISTS `ti_dispositivo_impresion` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `tipo` ENUM('IMPRESORA','ETIQUETADORA') NOT NULL,
  `modelo` VARCHAR(160) NOT NULL,
  `nombre_estandar` VARCHAR(160) NOT NULL,
  `tipo_conexion` ENUM('USB','RED','OTRO') NOT NULL DEFAULT 'USB',
  `ip` VARCHAR(45) DEFAULT NULL,
  `area` VARCHAR(120) NOT NULL DEFAULT '',
  `usuario_responsable` VARCHAR(160) NOT NULL DEFAULT '',
  `propiedad` ENUM('ADQUIRIDA','ARRENDADA') NOT NULL,
  `mantencion_requerida` DATE DEFAULT NULL,
  `ultima_mantencion` DATE DEFAULT NULL,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ti_disp_imp_tipo` (`tipo`),
  KEY `idx_ti_disp_imp_area` (`area`),
  KEY `idx_ti_disp_imp_activo` (`activo`),
  KEY `idx_ti_disp_imp_mantencion` (`mantencion_requerida`, `ultima_mantencion`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
