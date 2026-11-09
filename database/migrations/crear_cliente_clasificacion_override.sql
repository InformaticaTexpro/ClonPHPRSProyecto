-- Etapa 1: persistencia de decisiones administrativas globales por evento mensual.
-- No modifica ventas ni activa consultas desde los servicios existentes.
-- Los usuarios son referencias de auditoría sin claves foráneas.
-- Sin UNIQUE de evento: permite conservar el historial de decisiones y reversiones.
-- Rollback LOCAL (solo bajo solicitud explícita):
-- DROP TABLE IF EXISTS cliente_clasificacion_override;
-- Luego eliminar este archivo de migración.

CREATE TABLE IF NOT EXISTS `cliente_clasificacion_override` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `periodo` CHAR(7) NOT NULL COMMENT 'Evento mensual global, formato YYYY-MM',
  `tipo_evento` VARCHAR(20) NOT NULL,
  `accion` VARCHAR(20) NOT NULL,
  `rut_normalizado` VARCHAR(20) NOT NULL COMMENT 'RUT sin puntos ni guion',
  `rut_original` VARCHAR(20) NULL,
  `codaux` VARCHAR(30) NULL,
  `tipo_documento` VARCHAR(5) NULL,
  `folio` VARCHAR(30) NULL COMMENT 'Documento de referencia y validación',
  `nroint` VARCHAR(30) NULL,
  `fecha_documento` DATE NULL,
  `cliente_nombre` VARCHAR(255) NULL,
  `codigo_vendedor_origen` VARCHAR(30) NULL COMMENT 'Referencia informativa; no identifica el evento',
  `motivo_codigo` VARCHAR(80) NOT NULL,
  `motivo_detalle` VARCHAR(1000) NULL,
  `datos_validacion` LONGTEXT NULL COMMENT 'Evidencia JSON de Softland o cálculo automático; sin secretos',
  `creado_por` BIGINT NULL,
  `creado_por_nombre` VARCHAR(255) NULL,
  `creado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `revertido_por` BIGINT NULL,
  `revertido_por_nombre` VARCHAR(255) NULL,
  `revertido_en` DATETIME NULL,
  `motivo_reversion` VARCHAR(1000) NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_override_periodo_tipo` (`periodo`, `tipo_evento`, `activo`),
  INDEX `idx_override_rut` (`rut_normalizado`, `periodo`, `tipo_evento`, `activo`),
  INDEX `idx_override_codaux` (`codaux`, `periodo`),
  INDEX `idx_override_folio` (`folio`, `periodo`),
  INDEX `idx_override_activo` (`activo`, `creado_en`),
  CONSTRAINT `chk_override_periodo` CHECK (`periodo` REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT `chk_override_tipo_evento` CHECK (`tipo_evento` IN ('NUEVO', 'RECUPERADO')),
  CONSTRAINT `chk_override_accion` CHECK (`accion` IN ('INCLUIR', 'EXCLUIR')),
  CONSTRAINT `chk_override_activo` CHECK (`activo` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
