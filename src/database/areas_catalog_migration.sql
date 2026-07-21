-- Migración idempotente para catálogo maestro de áreas.
-- No modifica usuario.area. Mantiene compatibilidad con el sistema actual.

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
  KEY idx_area_perfil_base (perfil_base_id),
  CONSTRAINT fk_area_perfil_base
    FOREIGN KEY (perfil_base_id) REFERENCES perfil(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
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

UPDATE area a
INNER JOIN perfil p ON p.codigo = 'ventas'
SET a.perfil_base_id = p.id
WHERE a.codigo = 'ventas';

UPDATE area a
INNER JOIN perfil p ON p.codigo = 'produccion'
SET a.perfil_base_id = p.id
WHERE a.codigo = 'produccion';

UPDATE area a
INNER JOIN perfil p ON p.codigo = 'bodega'
SET a.perfil_base_id = p.id
WHERE a.codigo = 'bodega';

UPDATE area a
INNER JOIN perfil p ON p.codigo = 'servicio_tecnico'
SET a.perfil_base_id = p.id
WHERE a.codigo = 'servicio_tecnico';

UPDATE area a
INNER JOIN perfil p ON p.codigo = 'facturacion'
SET a.perfil_base_id = p.id
WHERE a.codigo = 'facturacion';

UPDATE area a
INNER JOIN perfil p ON p.codigo = 'contabilidad'
SET a.perfil_base_id = p.id
WHERE a.codigo = 'contabilidad';

UPDATE area a
INNER JOIN perfil p ON p.codigo = 'rrhh'
SET a.perfil_base_id = p.id
WHERE a.codigo = 'rrhh';

UPDATE area a
INNER JOIN perfil p ON p.codigo = 'gerencia'
SET a.perfil_base_id = p.id
WHERE a.codigo = 'gerencia';

UPDATE area a
INNER JOIN perfil p ON p.codigo IN ('administracion', 'admin')
SET a.perfil_base_id = p.id
WHERE a.codigo = 'administracion';

-- Diagnóstico sugerido para normalizar usuario.area sin cambios automáticos:
-- SELECT id, nombre, email, area
-- FROM usuario
-- ORDER BY area, nombre;
--
-- Actualizaciones seguras sugeridas (ejecutar solo con revisión previa):
-- UPDATE usuario SET area = 'ventas' WHERE LOWER(TRIM(area)) = 'ventas';
-- UPDATE usuario SET area = 'produccion' WHERE LOWER(TRIM(area)) IN ('produccion', 'producción');
-- UPDATE usuario SET area = 'servicio_tecnico' WHERE LOWER(TRIM(area)) IN ('servicio tecnico', 'servicio técnico', 'servicio-tecnico', 'servicio-técnico', 'servtecnico');
