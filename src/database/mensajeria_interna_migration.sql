-- Migracion idempotente para mensajeria interna.
-- No modifica tablas existentes ni toca Softland.

CREATE TABLE IF NOT EXISTS conversacion (
  id BIGINT NOT NULL AUTO_INCREMENT,
  tipo ENUM('directa', 'grupo', 'area', 'sistema') NOT NULL DEFAULT 'directa',
  titulo VARCHAR(150) NULL,
  area_codigo VARCHAR(80) NULL,
  creado_por BIGINT NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_conversacion_tipo (tipo),
  KEY idx_conversacion_area_codigo (area_codigo),
  KEY idx_conversacion_creado_por (creado_por),
  KEY idx_conversacion_activo (activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conversacion_participante (
  conversacion_id BIGINT NOT NULL,
  usuario_id BIGINT NOT NULL,
  rol ENUM('miembro', 'admin') NOT NULL DEFAULT 'miembro',
  silenciada TINYINT(1) NOT NULL DEFAULT 0,
  archivada TINYINT(1) NOT NULL DEFAULT 0,
  ultimo_leido_mensaje_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversacion_id, usuario_id),
  KEY idx_conversacion_participante_usuario (usuario_id),
  KEY idx_conversacion_participante_archivada (archivada),
  KEY idx_conversacion_participante_silenciada (silenciada)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mensaje (
  id BIGINT NOT NULL AUTO_INCREMENT,
  conversacion_id BIGINT NOT NULL,
  remitente_id BIGINT NOT NULL,
  cuerpo TEXT NOT NULL,
  tipo ENUM('texto', 'sistema') NOT NULL DEFAULT 'texto',
  eliminado TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  editado_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_mensaje_conversacion_created_at (conversacion_id, created_at),
  KEY idx_mensaje_remitente_id (remitente_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- La mensajeria interna se registra como menu del grupo General.
-- El acceso sigue disponible desde la cabecera global y la ruta directa del modulo.
