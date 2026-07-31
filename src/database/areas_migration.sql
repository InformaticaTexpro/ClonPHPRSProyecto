-- Migración idempotente para catálogo maestro de áreas.
-- Mantiene compatibilidad con usuario.area y no aplica DROP.
-- La relación con perfil_base_id se resuelve a nivel de aplicación
-- para evitar romper ambientes donde perfil todavía no exista.

CREATE TABLE IF NOT EXISTS area (
  id BIGINT NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(80) NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  descripcion VARCHAR(255) DEFAULT NULL,
  perfil_base_id BIGINT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_area_codigo (codigo),
  KEY idx_area_activo (activo),
  KEY idx_area_perfil_base (perfil_base_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO area (codigo, nombre, descripcion, activo)
VALUES
('ventas', 'Ventas', 'Área comercial y vendedores', 1),
('produccion', 'Producción', 'Área de producción', 1),
('bodega', 'Bodega', 'Área de bodega e inventario', 1),
('servicio_tecnico', 'Servicio Técnico', 'Área de servicio técnico', 1),
('facturacion', 'Facturación', 'Área de facturación', 1),
('contabilidad', 'Contabilidad', 'Área contable', 1),
('cobranza', 'Cobranza', 'Área de cobranza', 1),
('rrhh', 'RRHH', 'Área de recursos humanos', 1),
('gerencia', 'Gerencia', 'Área gerencial', 1),
('administracion', 'Administración', 'Área administrativa del sistema', 1),
('general', 'General', 'Área general del sistema', 1)
ON DUPLICATE KEY UPDATE
  nombre = VALUES(nombre),
  descripcion = VALUES(descripcion),
  activo = VALUES(activo);
