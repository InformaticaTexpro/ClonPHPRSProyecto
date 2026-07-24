-- Migracion idempotente para soportar periodos mensuales/anuales en vendedor_meta
-- Reglas:
--   - No elimina datos
--   - No hace DROP de tablas
--   - Agrega columnas solo si faltan
--   - Asegura una clave unica por usuario + tipo_periodo + fecha

SET @db_name := DATABASE();

-- 1) Agregar columna tipo_periodo si no existe
SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'vendedor_meta'
    AND column_name = 'tipo_periodo'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE vendedor_meta ADD COLUMN tipo_periodo ENUM(''mensual'',''anual'') NOT NULL DEFAULT ''mensual'' AFTER fecha',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) Agregar columna activo si no existe
SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'vendedor_meta'
    AND column_name = 'activo'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE vendedor_meta ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1 AFTER meta',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3) Agregar columna observacion si no existe
SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'vendedor_meta'
    AND column_name = 'observacion'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE vendedor_meta ADD COLUMN observacion VARCHAR(255) NULL AFTER activo',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4) Agregar metadatos de auditoria si faltan
SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'vendedor_meta'
    AND column_name = 'created_at'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE vendedor_meta ADD COLUMN created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP AFTER observacion',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'vendedor_meta'
    AND column_name = 'updated_at'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE vendedor_meta ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5) Normalizar tipo_periodo para registros existentes
UPDATE vendedor_meta
   SET tipo_periodo = CASE
     WHEN tipo_periodo IS NULL OR TRIM(tipo_periodo) = '' THEN
       CASE
         WHEN MONTH(fecha) = 1 AND DAY(fecha) = 1 THEN 'anual'
         ELSE 'mensual'
       END
     ELSE tipo_periodo
   END;

-- 6) Actualizar perfiles base por area
UPDATE perfil
   SET area = 'ventas', es_base = 1
 WHERE codigo = 'ventas';
UPDATE perfil
   SET area = 'facturacion', es_base = 1
 WHERE codigo = 'facturacion';
UPDATE perfil
   SET area = 'produccion', es_base = 1
 WHERE codigo = 'produccion';
UPDATE perfil
   SET area = 'bodega', es_base = 1
 WHERE codigo = 'bodega';
UPDATE perfil
   SET area = 'servicio_tecnico', es_base = 1
 WHERE codigo = 'servicio_tecnico';
UPDATE perfil
   SET area = 'contabilidad', es_base = 1
 WHERE codigo = 'contabilidad';
UPDATE perfil
   SET area = 'rrhh', es_base = 1
 WHERE codigo = 'rrhh';
UPDATE perfil
   SET area = 'gerencia', es_base = 1
 WHERE codigo = 'gerencia';
UPDATE perfil
   SET area = 'admin', es_base = 1
 WHERE codigo IN ('administracion', 'admin');

-- 7) Eliminar la unica vieja si existe
SET @old_index := (
  SELECT index_name
  FROM information_schema.statistics
  WHERE table_schema = @db_name
    AND table_name = 'vendedor_meta'
    AND non_unique = 0
  GROUP BY index_name
  HAVING GROUP_CONCAT(column_name ORDER BY seq_in_index) = 'usuario_id,fecha'
  LIMIT 1
);
SET @sql := IF(
  @old_index IS NULL,
  'SELECT 1',
  CONCAT('ALTER TABLE vendedor_meta DROP INDEX `', @old_index, '`')
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 8) Crear la unica nueva si no existe
SET @new_index := (
  SELECT index_name
  FROM information_schema.statistics
  WHERE table_schema = @db_name
    AND table_name = 'vendedor_meta'
    AND non_unique = 0
  GROUP BY index_name
  HAVING GROUP_CONCAT(column_name ORDER BY seq_in_index) = 'usuario_id,tipo_periodo,fecha'
  LIMIT 1
);
SET @sql := IF(
  @new_index IS NULL,
  'ALTER TABLE vendedor_meta ADD UNIQUE KEY uq_vendedor_meta_usuario_tipo_fecha (usuario_id, tipo_periodo, fecha)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 9) Revision de duplicados antes de aplicar o validar la unica
SELECT
  usuario_id,
  tipo_periodo,
  fecha,
  COUNT(*) AS total
FROM vendedor_meta
GROUP BY usuario_id, tipo_periodo, fecha
HAVING COUNT(*) > 1;
