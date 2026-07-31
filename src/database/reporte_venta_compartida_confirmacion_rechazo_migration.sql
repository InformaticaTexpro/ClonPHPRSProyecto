-- Agrega columnas de rechazo a reporte_venta_compartida_confirmacion.
-- Migración idempotente: solo crea las columnas si aún no existen.
-- Compatible con MySQL/MariaDB sin depender de ADD COLUMN IF NOT EXISTS.

SET @schema_name := DATABASE();

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @schema_name
    AND table_name = 'reporte_venta_compartida_confirmacion'
    AND column_name = 'rechazado_por'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE reporte_venta_compartida_confirmacion ADD COLUMN rechazado_por BIGINT NULL AFTER comentario_rrhh',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @schema_name
    AND table_name = 'reporte_venta_compartida_confirmacion'
    AND column_name = 'rechazado_at'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE reporte_venta_compartida_confirmacion ADD COLUMN rechazado_at DATETIME NULL AFTER rechazado_por',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @schema_name
    AND table_name = 'reporte_venta_compartida_confirmacion'
    AND column_name = 'motivo_rechazo'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE reporte_venta_compartida_confirmacion ADD COLUMN motivo_rechazo VARCHAR(500) NULL AFTER rechazado_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
