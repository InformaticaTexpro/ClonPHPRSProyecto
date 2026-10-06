-- ============================================================
-- SEC-LOCAL-003
-- Endurecimiento de OTP para recuperación de contraseña.
-- Compatible con MariaDB 10.11.
-- ============================================================

ALTER TABLE `otp_tokens`
  ADD COLUMN IF NOT EXISTS `codigo_hash` VARCHAR(64) NULL AFTER `codigo`,
  ADD COLUMN IF NOT EXISTS `intentos_fallidos` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `usado`,
  ADD COLUMN IF NOT EXISTS `bloqueado_hasta` DATETIME(6) NULL AFTER `intentos_fallidos`,
  ADD COLUMN IF NOT EXISTS `ultimo_intento_en` DATETIME(6) NULL AFTER `bloqueado_hasta`;

CREATE INDEX IF NOT EXISTS `idx_otp_email_creado` ON `otp_tokens` (`email`, `creado_en`);
CREATE INDEX IF NOT EXISTS `idx_otp_email_activo` ON `otp_tokens` (`email`, `usado`, `expira_en`);

UPDATE `otp_tokens`
SET `usado` = 1,
    `ultimo_intento_en` = COALESCE(`ultimo_intento_en`, NOW(6))
WHERE `codigo_hash` IS NULL
  AND `usado` = 0;
