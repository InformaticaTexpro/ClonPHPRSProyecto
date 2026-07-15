-- MIGRACION: normaliza campos de preferencias por destinatario en alertas
-- Ejecutar una sola vez en MariaDB 10.4.32 / MySQL compatibles.
-- Orden seguro:
--   1) agregar silenciada si falta
--   2) agregar archivada si falta, despues de silenciada
--   3) conservar fecha_archivada para la logica actual del modulo

ALTER TABLE alerta_destinatarios
  ADD COLUMN IF NOT EXISTS silenciada TINYINT(1) NOT NULL DEFAULT 0
  AFTER descartada_hoy;

ALTER TABLE alerta_destinatarios
  ADD COLUMN IF NOT EXISTS archivada TINYINT(1) NOT NULL DEFAULT 0
  AFTER silenciada;

ALTER TABLE alerta_destinatarios
  ADD COLUMN IF NOT EXISTS fecha_archivada DATETIME NULL
  AFTER archivada;
