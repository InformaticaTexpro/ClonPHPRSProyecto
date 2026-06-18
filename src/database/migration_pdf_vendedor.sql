-- =============================================================
-- MIGRACIÓN: PDF de contrato por vendedor
-- Base de datos: bdtexpro
-- Fecha: 2026-06-18
-- Descripción:
--   1. Agrega columna `rut`          a tabla `usuario`  (RUT del vendedor)
--   2. Agrega columna `pdf_contrato` a tabla `usuario`  (ruta relativa al PDF)
-- =============================================================

-- 1. RUT del vendedor (puede ser NULL en usuarios que no sean vendedores)
ALTER TABLE `usuario`
  ADD COLUMN `rut` VARCHAR(12) NULL DEFAULT NULL
  COMMENT 'RUT del vendedor (ej: 12.345.678-9)'
  AFTER `codigo`;

-- 2. Ruta relativa al PDF de contrato almacenado en disco
--    Ejemplo: uploads/contratos/usuario_8_contrato.pdf
ALTER TABLE `usuario`
  ADD COLUMN `pdf_contrato` VARCHAR(255) NULL DEFAULT NULL
  COMMENT 'Ruta relativa al PDF del contrato del vendedor'
  AFTER `rut`;

-- 3. Índice para búsquedas por RUT (opcional pero recomendado)
ALTER TABLE `usuario`
  ADD INDEX `idx_usuario_rut` (`rut`);

-- =============================================================
-- FIN DE MIGRACIÓN
-- Para ejecutar: mysql -u <user> -p bdtexpro < migration_pdf_vendedor.sql
-- =============================================================
