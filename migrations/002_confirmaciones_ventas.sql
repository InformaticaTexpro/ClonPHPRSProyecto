-- ============================================================
-- Migración 002: tabla confirmaciones_ventas
-- Ejecutar UNA sola vez en bdtexpro
-- Motor: MariaDB 10.4+  |  Fecha: 2026-06-18
-- ============================================================

USE bdtexpro;

CREATE TABLE IF NOT EXISTS `confirmaciones_ventas` (
  `id`                  INT(10) UNSIGNED     NOT NULL AUTO_INCREMENT,
  `usuario_id`          BIGINT(20)           NOT NULL                  COMMENT 'FK → usuarios.id',
  `mes`                 TINYINT(4)           NOT NULL                  COMMENT '1–12',
  `anio`                SMALLINT(6)          NOT NULL,
  `fecha_confirmacion`  DATETIME             NOT NULL DEFAULT current_timestamp(),
  `ruta_pdf`            VARCHAR(500)         NOT NULL                  COMMENT 'Ruta relativa en disco: storage/confirmaciones/…',
  `nombre_archivo`      VARCHAR(200)         NOT NULL,
  `total_ventas_propias` DECIMAL(15,2)       NOT NULL DEFAULT 0,
  `total_ventas_asignadas` DECIMAL(15,2)     NOT NULL DEFAULT 0,
  `total_folios`        INT(11)              NOT NULL DEFAULT 0,
  `total_facturas_compartidas` INT(11)       NOT NULL DEFAULT 0,
  `ip_confirmacion`     VARCHAR(45)          DEFAULT NULL              COMMENT 'IP del usuario al confirmar',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_usuario_mes_anio` (`usuario_id`, `mes`, `anio`),
  CONSTRAINT `fk_confirmacion_usuario`
    FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Confirmaciones mensuales de ventas por vendedor/coordinador';
