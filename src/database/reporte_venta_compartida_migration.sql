-- Migración idempotente para el flujo de ventas compartidas.
-- Asegura la tabla correcta `reporte_venta_compartida_confirmacion`
-- y copia datos desde la tabla antigua si aún existe.

CREATE TABLE IF NOT EXISTS reporte_venta_compartida_confirmacion (
  id BIGINT NOT NULL AUTO_INCREMENT,
  vendedor_usuario_id BIGINT NOT NULL,
  vendedor_nombre VARCHAR(150) NOT NULL,
  vendedor_email VARCHAR(150) NULL,
  anio SMALLINT NOT NULL,
  mes TINYINT NOT NULL,
  periodo_label VARCHAR(50) NULL,
  total_venta DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_venta_real DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_descuento DECIMAL(15,2) NULL,
  total_comision DECIMAL(15,2) NULL,
  cantidad_folios INT NOT NULL DEFAULT 0,
  cantidad_lineas INT NOT NULL DEFAULT 0,
  reporte_json LONGTEXT NULL,
  reporte_pdf_path VARCHAR(255) NULL,
  estado ENUM('confirmado_vendedor','validado_rrhh','rechazado_rrhh') NOT NULL DEFAULT 'confirmado_vendedor',
  confirmado_por BIGINT NOT NULL,
  confirmado_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revisado_por BIGINT NULL,
  revisado_at DATETIME NULL,
  comentario_rrhh VARCHAR(500) NULL,
  rechazado_por BIGINT NULL,
  rechazado_at DATETIME NULL,
  motivo_rechazo VARCHAR(500) NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reporte_venta_compartida_confirmacion_vendedor_periodo (vendedor_usuario_id, anio, mes),
  KEY idx_reporte_venta_compartida_confirmacion_vendedor (vendedor_usuario_id),
  KEY idx_reporte_venta_compartida_confirmacion_periodo (anio, mes),
  KEY idx_reporte_venta_compartida_confirmacion_estado (estado),
  KEY idx_reporte_venta_compartida_confirmacion_confirmado_at (confirmado_at),
  KEY idx_reporte_venta_compartida_confirmacion_revisado_por (revisado_por)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

SET @table_exists := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name = 'reporte_venta_compartida_confirmacion'
);

SET @sql := IF(
  @table_exists > 0,
  'ALTER TABLE reporte_venta_compartida_confirmacion
     ADD COLUMN IF NOT EXISTS rechazado_por BIGINT NULL AFTER comentario_rrhh,
     ADD COLUMN IF NOT EXISTS rechazado_at DATETIME NULL AFTER rechazado_por,
     ADD COLUMN IF NOT EXISTS motivo_rechazo VARCHAR(500) NULL AFTER rechazado_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
