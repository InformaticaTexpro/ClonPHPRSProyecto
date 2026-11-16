-- Solo MySQL GICOTEX. No consulta ni modifica Softland.
CREATE TABLE IF NOT EXISTS cliente_solicitud (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 correlativo VARCHAR(24) NULL UNIQUE,
 tipo ENUM('PROSPECTO','FICHA') NOT NULL DEFAULT 'PROSPECTO',
 estado ENUM('BORRADOR','PENDIENTE','EN_REVISION','OBSERVADA','COMPLETADA','ANULADA') NOT NULL DEFAULT 'BORRADOR',
 usuario_vendedor_id BIGINT NOT NULL,
 vendedor_nombre VARCHAR(255) NOT NULL,
 vendedor_email VARCHAR(254) NOT NULL,
 codigo_vendedor VARCHAR(30) NOT NULL,
 solicitud_origen_id BIGINT UNSIGNED NULL,
 rut_original VARCHAR(20) NOT NULL DEFAULT '',
 rut_normalizado VARCHAR(12) NOT NULL DEFAULT '',
 razon_social VARCHAR(120) NOT NULL DEFAULT '',
 contacto_nombre VARCHAR(100) NOT NULL DEFAULT '',
 contacto_email VARCHAR(150) NOT NULL DEFAULT '',
 telefono VARCHAR(30) NOT NULL DEFAULT '',
 productos_interes TEXT NULL,
 observacion_vendedor TEXT NULL,
 codigo_auxiliar_softland VARCHAR(30) NULL,
 procesado_por BIGINT NULL,
 procesado_por_nombre VARCHAR(255) NULL,
 creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 enviado_en DATETIME NULL,
 completado_en DATETIME NULL,
 rut_activo VARCHAR(12) GENERATED ALWAYS AS (
   CASE WHEN estado IN ('BORRADOR','PENDIENTE','EN_REVISION','OBSERVADA')
     THEN NULLIF(rut_normalizado, '') ELSE NULL END
 ) STORED,
 ficha_origen_activa BIGINT UNSIGNED GENERATED ALWAYS AS (
   CASE WHEN tipo='FICHA' AND estado IN ('BORRADOR','PENDIENTE','EN_REVISION','OBSERVADA') THEN solicitud_origen_id ELSE NULL END
 ) STORED,
 UNIQUE KEY uq_cliente_solicitud_rut_activo (tipo,rut_activo),
 UNIQUE KEY uq_cliente_ficha_origen_activo (ficha_origen_activa),
 KEY idx_cliente_solicitud_vendedor (usuario_vendedor_id,estado,creado_en),
 KEY idx_cliente_solicitud_estado (tipo,estado,creado_en),
 KEY idx_cliente_solicitud_rut (rut_normalizado),
 KEY idx_cliente_solicitud_origen (solicitud_origen_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cliente_solicitud_secuencia (
 tipo ENUM('PROSPECTO','FICHA') NOT NULL,
 anio SMALLINT UNSIGNED NOT NULL,
 ultimo BIGINT UNSIGNED NOT NULL DEFAULT 0,
 PRIMARY KEY (tipo,anio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Actualización compatible con la primera versión local, sin perder secuencias.
SET @cliente_upgrade = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
 AND TABLE_NAME='cliente_solicitud_secuencia' AND COLUMN_NAME='tipo')=0,
 'ALTER TABLE cliente_solicitud_secuencia ADD COLUMN tipo ENUM(''PROSPECTO'',''FICHA'') NOT NULL DEFAULT ''PROSPECTO'', DROP PRIMARY KEY, ADD PRIMARY KEY(tipo,anio)', 'SET @cliente_upgrade_noop=1');
PREPARE cliente_upgrade_stmt FROM @cliente_upgrade;
EXECUTE cliente_upgrade_stmt;
DEALLOCATE PREPARE cliente_upgrade_stmt;
SET @cliente_upgrade = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
 AND TABLE_NAME='cliente_solicitud' AND COLUMN_NAME='ficha_origen_activa')=0,
 'ALTER TABLE cliente_solicitud ADD COLUMN ficha_origen_activa BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN tipo=''FICHA'' AND estado IN (''BORRADOR'',''PENDIENTE'',''EN_REVISION'',''OBSERVADA'') THEN solicitud_origen_id ELSE NULL END) STORED, ADD UNIQUE KEY uq_cliente_ficha_origen_activo (ficha_origen_activa)',
 'SET @cliente_upgrade_noop=1');
PREPARE cliente_upgrade_stmt FROM @cliente_upgrade;
EXECUTE cliente_upgrade_stmt;
DEALLOCATE PREPARE cliente_upgrade_stmt;
ALTER TABLE cliente_solicitud MODIFY COLUMN rut_activo VARCHAR(12) GENERATED ALWAYS AS (
 CASE WHEN estado IN ('BORRADOR','PENDIENTE','EN_REVISION','OBSERVADA') THEN NULLIF(rut_normalizado,'') ELSE NULL END
) STORED, DROP INDEX uq_cliente_solicitud_rut_activo, ADD UNIQUE KEY uq_cliente_solicitud_rut_activo (tipo,rut_activo);

CREATE TABLE IF NOT EXISTS cliente_solicitud_ficha (
 solicitud_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 trabaja_con VARCHAR(30) NOT NULL DEFAULT '',
 tipo_empresa VARCHAR(20) NOT NULL DEFAULT '',
 origen_codigo VARCHAR(64) NULL,
 rubro_codigo VARCHAR(64) NULL,
 forma_pago_codigo VARCHAR(64) NULL,
 forma_pago VARCHAR(30) NOT NULL DEFAULT 'CONTADO',
 origen_canal VARCHAR(120) NOT NULL DEFAULT '',
 rubro VARCHAR(40) NOT NULL DEFAULT '',
 rubro_otro VARCHAR(120) NOT NULL DEFAULT '',
 giro VARCHAR(255) NOT NULL DEFAULT '',
 nombre_fantasia VARCHAR(120) NOT NULL DEFAULT '',
 direccion_comercial VARCHAR(255) NOT NULL DEFAULT '',
 ciudad VARCHAR(100) NOT NULL DEFAULT '',
 comuna VARCHAR(100) NOT NULL DEFAULT '',
 direccion_despacho VARCHAR(255) NOT NULL DEFAULT '',
 telefono_empresa VARCHAR(30) NOT NULL DEFAULT '',
 linea_productos VARCHAR(800) NOT NULL DEFAULT '',
 tipo_precio VARCHAR(20) NOT NULL DEFAULT '',
 encargado_compras VARCHAR(100) NOT NULL DEFAULT '',
 telefono_compras VARCHAR(30) NOT NULL DEFAULT '',
 email_compras VARCHAR(150) NOT NULL DEFAULT '',
 contacto_finanzas VARCHAR(100) NOT NULL DEFAULT '',
 telefono_finanzas VARCHAR(30) NOT NULL DEFAULT '',
 email_finanzas VARCHAR(150) NOT NULL DEFAULT '',
 sitio_web VARCHAR(255) NOT NULL DEFAULT '',
 banco_referencia VARCHAR(100) NOT NULL DEFAULT '',
 tipo_cuenta_referencia VARCHAR(60) NOT NULL DEFAULT '',
 numero_cuenta_referencia VARCHAR(60) NOT NULL DEFAULT '',
 titular_cuenta_referencia VARCHAR(120) NOT NULL DEFAULT '',
 rut_titular_cuenta_referencia VARCHAR(20) NOT NULL DEFAULT '',
 email_transferencia_referencia VARCHAR(150) NOT NULL DEFAULT '',
 cliente_clasificacion_interna VARCHAR(30) NOT NULL DEFAULT 'Sin Clasificar',
 ultima_compra DATE NULL,
 mes_creacion CHAR(7) NOT NULL DEFAULT '',
 correlativo_interno VARCHAR(60) NOT NULL DEFAULT '',
 observacion_cobranza TEXT NULL,
 creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- Catálogos configurables. Los campos anteriores de ficha conservan el snapshot.
CREATE TABLE IF NOT EXISTS cliente_solicitud_catalogo (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 tipo VARCHAR(30) NOT NULL,
 codigo VARCHAR(64) NOT NULL,
 nombre VARCHAR(120) NOT NULL,
 orden INT NOT NULL DEFAULT 0,
 activo TINYINT(1) NOT NULL DEFAULT 1,
 usado_en DATETIME NULL,
 creado_por BIGINT NULL,
 creado_por_nombre VARCHAR(255) NULL,
 creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 actualizado_por BIGINT NULL,
 actualizado_por_nombre VARCHAR(255) NULL,
 actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_cliente_catalogo_codigo (tipo,codigo),
 KEY idx_cliente_catalogo_activo (tipo,activo,orden)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO cliente_solicitud_catalogo (tipo,codigo,nombre,orden,activo) SELECT 'ORIGEN','LLAMADO_EMPRESA','Llamado telefónico / Empresa',1,1 WHERE NOT EXISTS (SELECT 1 FROM cliente_solicitud_catalogo WHERE tipo='ORIGEN' AND codigo='LLAMADO_EMPRESA');
INSERT INTO cliente_solicitud_catalogo (tipo,codigo,nombre,orden,activo) SELECT 'ORIGEN','LLAMADO_VENDEDOR','Llamado telefónico / Vendedor',2,1 WHERE NOT EXISTS (SELECT 1 FROM cliente_solicitud_catalogo WHERE tipo='ORIGEN' AND codigo='LLAMADO_VENDEDOR');
INSERT INTO cliente_solicitud_catalogo (tipo,codigo,nombre,orden,activo) SELECT 'ORIGEN','FORMULARIO_WEB','Formulario web',3,1 WHERE NOT EXISTS (SELECT 1 FROM cliente_solicitud_catalogo WHERE tipo='ORIGEN' AND codigo='FORMULARIO_WEB');
INSERT INTO cliente_solicitud_catalogo (tipo,codigo,nombre,orden,activo) SELECT 'ORIGEN','WHATSAPP','WhatsApp',4,1 WHERE NOT EXISTS (SELECT 1 FROM cliente_solicitud_catalogo WHERE tipo='ORIGEN' AND codigo='WHATSAPP');
INSERT INTO cliente_solicitud_catalogo (tipo,codigo,nombre,orden,activo) SELECT 'ORIGEN','REFERIDO_CLIENTE','Referido cliente',5,1 WHERE NOT EXISTS (SELECT 1 FROM cliente_solicitud_catalogo WHERE tipo='ORIGEN' AND codigo='REFERIDO_CLIENTE');
INSERT INTO cliente_solicitud_catalogo (tipo,codigo,nombre,orden,activo) SELECT 'ORIGEN','GOOGLE_INTERNET','Google / Internet',6,1 WHERE NOT EXISTS (SELECT 1 FROM cliente_solicitud_catalogo WHERE tipo='ORIGEN' AND codigo='GOOGLE_INTERNET');
INSERT INTO cliente_solicitud_catalogo (tipo,codigo,nombre,orden,activo) SELECT 'ORIGEN','REDES_SOCIALES','Redes sociales',7,1 WHERE NOT EXISTS (SELECT 1 FROM cliente_solicitud_catalogo WHERE tipo='ORIGEN' AND codigo='REDES_SOCIALES');
INSERT INTO cliente_solicitud_catalogo (tipo,codigo,nombre,orden,activo) SELECT 'RUBRO','METALURGICA','Metalúrgica',1,1 WHERE NOT EXISTS (SELECT 1 FROM cliente_solicitud_catalogo WHERE tipo='RUBRO' AND codigo='METALURGICA');
INSERT INTO cliente_solicitud_catalogo (tipo,codigo,nombre,orden,activo) SELECT 'RUBRO','MADERERA','Maderera',2,1 WHERE NOT EXISTS (SELECT 1 FROM cliente_solicitud_catalogo WHERE tipo='RUBRO' AND codigo='MADERERA');
INSERT INTO cliente_solicitud_catalogo (tipo,codigo,nombre,orden,activo) SELECT 'RUBRO','MINERIA','Minería',3,1 WHERE NOT EXISTS (SELECT 1 FROM cliente_solicitud_catalogo WHERE tipo='RUBRO' AND codigo='MINERIA');
INSERT INTO cliente_solicitud_catalogo (tipo,codigo,nombre,orden,activo) SELECT 'RUBRO','DISTRIBUIDORA','Distribuidora',4,1 WHERE NOT EXISTS (SELECT 1 FROM cliente_solicitud_catalogo WHERE tipo='RUBRO' AND codigo='DISTRIBUIDORA');
INSERT INTO cliente_solicitud_catalogo (tipo,codigo,nombre,orden,activo) SELECT 'RUBRO','OTROS','Otros',5,1 WHERE NOT EXISTS (SELECT 1 FROM cliente_solicitud_catalogo WHERE tipo='RUBRO' AND codigo='OTROS');
INSERT INTO cliente_solicitud_catalogo (tipo,codigo,nombre,orden,activo) SELECT 'FORMA_PAGO','CONTADO','Contado',1,1 WHERE NOT EXISTS (SELECT 1 FROM cliente_solicitud_catalogo WHERE tipo='FORMA_PAGO' AND codigo='CONTADO');

-- Upgrade catálogo: solo agrega referencias, nunca reemplaza textos existentes.
SET @cliente_upgrade = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cliente_solicitud_ficha' AND COLUMN_NAME='origen_codigo')=0,
 'ALTER TABLE cliente_solicitud_ficha ADD COLUMN origen_codigo VARCHAR(64) NULL', 'SET @cliente_upgrade_noop=1');
PREPARE cliente_upgrade_stmt FROM @cliente_upgrade;
EXECUTE cliente_upgrade_stmt;
DEALLOCATE PREPARE cliente_upgrade_stmt;
SET @cliente_upgrade = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cliente_solicitud_ficha' AND COLUMN_NAME='rubro_codigo')=0,
 'ALTER TABLE cliente_solicitud_ficha ADD COLUMN rubro_codigo VARCHAR(64) NULL', 'SET @cliente_upgrade_noop=1');
PREPARE cliente_upgrade_stmt FROM @cliente_upgrade;
EXECUTE cliente_upgrade_stmt;
DEALLOCATE PREPARE cliente_upgrade_stmt;
SET @cliente_upgrade = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cliente_solicitud_ficha' AND COLUMN_NAME='forma_pago_codigo')=0,
 'ALTER TABLE cliente_solicitud_ficha ADD COLUMN forma_pago_codigo VARCHAR(64) NULL', 'SET @cliente_upgrade_noop=1');
PREPARE cliente_upgrade_stmt FROM @cliente_upgrade;
EXECUTE cliente_upgrade_stmt;
DEALLOCATE PREPARE cliente_upgrade_stmt;
-- Fin upgrade catálogo.
UPDATE cliente_solicitud_ficha SET origen_codigo=(SELECT MIN(c.codigo) FROM cliente_solicitud_catalogo c WHERE c.tipo='ORIGEN' AND (c.codigo=cliente_solicitud_ficha.origen_canal OR c.nombre=cliente_solicitud_ficha.origen_canal) HAVING COUNT(*)=1) WHERE origen_codigo IS NULL;
UPDATE cliente_solicitud_catalogo SET usado_en=COALESCE(usado_en,CURRENT_TIMESTAMP) WHERE tipo='ORIGEN' AND EXISTS (SELECT 1 FROM cliente_solicitud_ficha f WHERE f.origen_codigo=cliente_solicitud_catalogo.codigo OR (f.origen_codigo IS NULL AND (f.origen_canal=cliente_solicitud_catalogo.nombre OR f.origen_canal=cliente_solicitud_catalogo.codigo)));
UPDATE cliente_solicitud_ficha SET rubro_codigo=(SELECT MIN(c.codigo) FROM cliente_solicitud_catalogo c WHERE c.tipo='RUBRO' AND (c.codigo=cliente_solicitud_ficha.rubro OR c.nombre=cliente_solicitud_ficha.rubro) HAVING COUNT(*)=1) WHERE rubro_codigo IS NULL;
UPDATE cliente_solicitud_catalogo SET usado_en=COALESCE(usado_en,CURRENT_TIMESTAMP) WHERE tipo='RUBRO' AND EXISTS (SELECT 1 FROM cliente_solicitud_ficha f WHERE f.rubro_codigo=cliente_solicitud_catalogo.codigo OR (f.rubro_codigo IS NULL AND (f.rubro=cliente_solicitud_catalogo.nombre OR f.rubro=cliente_solicitud_catalogo.codigo)));
UPDATE cliente_solicitud_ficha SET forma_pago_codigo=(SELECT MIN(c.codigo) FROM cliente_solicitud_catalogo c WHERE c.tipo='FORMA_PAGO' AND (c.codigo=cliente_solicitud_ficha.forma_pago OR c.nombre=cliente_solicitud_ficha.forma_pago) HAVING COUNT(*)=1) WHERE forma_pago_codigo IS NULL;
UPDATE cliente_solicitud_catalogo SET usado_en=COALESCE(usado_en,CURRENT_TIMESTAMP) WHERE tipo='FORMA_PAGO' AND EXISTS (SELECT 1 FROM cliente_solicitud_ficha f WHERE f.forma_pago_codigo=cliente_solicitud_catalogo.codigo OR (f.forma_pago_codigo IS NULL AND (f.forma_pago=cliente_solicitud_catalogo.nombre OR f.forma_pago=cliente_solicitud_catalogo.codigo)));

CREATE TABLE IF NOT EXISTS cliente_solicitud_historial (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 solicitud_id BIGINT UNSIGNED NOT NULL,
 accion VARCHAR(40) NOT NULL,
 estado_anterior VARCHAR(20) NULL,
 estado_nuevo VARCHAR(20) NOT NULL,
 usuario_id BIGINT NOT NULL,
 usuario_nombre VARCHAR(255) NOT NULL,
 comentario TEXT NULL,
 datos_evento LONGTEXT NULL,
 creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY idx_cliente_historial (solicitud_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cliente_solicitud_responsable (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 usuario_id BIGINT NULL,
 nombre VARCHAR(255) NOT NULL,
 email VARCHAR(254) NOT NULL,
 recibe_prospecto TINYINT(1) NOT NULL DEFAULT 1,
 recibe_ficha TINYINT(1) NOT NULL DEFAULT 1,
 recibe_correo TINYINT(1) NOT NULL DEFAULT 1,
 activo TINYINT(1) NOT NULL DEFAULT 1,
 creado_por BIGINT NULL,
 actualizado_por BIGINT NULL,
 creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_cliente_responsable_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO cliente_solicitud_responsable (nombre,email)
VALUES ('Patricia Tapia','ptapia@texpro.cl'),('Analista Cobranzas','analistacobranzas@texpro.cl')
ON DUPLICATE KEY UPDATE id = id;

-- Permisos iniciales C&P: retirar la herencia antigua antes de renombrar los menús.
-- El nombre anterior identifica el upgrade pendiente. Una vez renombrado, las
-- habilitaciones posteriores desde Administración / Perfiles se conservan al reejecutar.
UPDATE perfil_menu SET activo=0
WHERE perfil_id IN (SELECT id FROM perfil WHERE codigo='ventas')
 AND menu_id IN (SELECT id FROM menu WHERE codigo='ventas_clientes_prospectos' AND nombre='Clientes y Prospectos');
UPDATE perfil_menu SET activo=0
WHERE perfil_id IN (SELECT id FROM perfil WHERE codigo='cobranza')
 AND menu_id IN (SELECT id FROM menu WHERE codigo='cobranza_clientes_prospectos' AND nombre='Clientes y Prospectos');
INSERT INTO menu (codigo,nombre,grupo,url,icono,orden,activo) VALUES
 ('ventas_clientes_prospectos','Solicitudes C&P','Ventas','/src/modulo/ventas/clientes-prospectos/index.html','handshake',5,1),
 ('cobranza_clientes_prospectos','Solicitudes C&P','Cobranza','/src/modulo/cobranza/clientes-prospectos/index.html','handshake',4,1)
ON DUPLICATE KEY UPDATE
 nombre = VALUES(nombre),
 grupo = VALUES(grupo),
 url = VALUES(url),
 icono = VALUES(icono),
 orden = VALUES(orden),
 activo = VALUES(activo);

INSERT INTO perfil_menu (perfil_id,menu_id,activo)
SELECT p.id,m.id,1 FROM perfil p INNER JOIN menu m ON
 (m.codigo='ventas_clientes_prospectos' AND p.codigo IN ('administracion','admin')) OR
 (m.codigo='cobranza_clientes_prospectos' AND p.codigo IN ('administracion','admin'))
ON DUPLICATE KEY UPDATE activo=VALUES(activo);

-- Registrar el estado inicial sin sobrescribir futuras concesiones del CRUD.
INSERT INTO perfil_menu (perfil_id,menu_id,activo)
SELECT p.id,m.id,0 FROM perfil p INNER JOIN menu m ON
 (m.codigo='ventas_clientes_prospectos' AND p.codigo='ventas') OR
 (m.codigo='cobranza_clientes_prospectos' AND p.codigo='cobranza')
ON DUPLICATE KEY UPDATE menu_id=menu_id;
