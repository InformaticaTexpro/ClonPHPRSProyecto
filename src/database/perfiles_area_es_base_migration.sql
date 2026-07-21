-- =============================================================================
-- Migración idempotente para compatibilidad de perfiles por área
-- Agrega columnas faltantes en `perfil` sin borrar datos ni hacer DROP.
-- =============================================================================

SET @db_name := DATABASE();

SELECT COUNT(*)
INTO @has_area
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = @db_name
  AND TABLE_NAME = 'perfil'
  AND COLUMN_NAME = 'area';

SET @sql_area := IF(
  @has_area = 0,
  'ALTER TABLE perfil ADD COLUMN area VARCHAR(80) NULL',
  'SELECT 1'
);

PREPARE stmt_area FROM @sql_area;
EXECUTE stmt_area;
DEALLOCATE PREPARE stmt_area;

SELECT COUNT(*)
INTO @has_es_base
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = @db_name
  AND TABLE_NAME = 'perfil'
  AND COLUMN_NAME = 'es_base';

SET @sql_es_base := IF(
  @has_es_base = 0,
  'ALTER TABLE perfil ADD COLUMN es_base TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1'
);

PREPARE stmt_es_base FROM @sql_es_base;
EXECUTE stmt_es_base;
DEALLOCATE PREPARE stmt_es_base;

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
WHERE codigo = 'servicio-tecnico';

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
