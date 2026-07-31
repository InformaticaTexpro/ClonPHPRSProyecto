# Auditoría BD vs Código

Fecha de auditoría: 2026-07-28

## 1. Resumen ejecutivo

La revisión del dump `database/bdtexpro.sql` y del código fuente confirma que el esquema base del dump contiene solo un subconjunto de tablas del sistema. El resto de la funcionalidad del proyecto depende de migraciones y tablas definidas en archivos SQL adicionales dentro de `database/` y `src/database/`.

Hallazgo relevante:
- El menú `rrhh` estaba registrado en BD con `grupo = 'General'` en la migración de catálogo de administración.
- El comportamiento correcto es `grupo = 'RRHH'`.
- El sidebar agrupa por `menu.grupo`, por lo que un valor incorrecto en BD hace que RRHH aparezca dentro de General.

Conclusión:
- No se detectó lógica que obligue de forma general a RRHH a vivir en General.
- El riesgo principal está en datos de catálogo y no en el render del sidebar.
- No se deben eliminar columnas por búsqueda textual aislada. Varias columnas sin uso directo aparente son indirectas, de migración o están reservadas para evolución del sistema.

## 2. Alcance real del dump `bdtexpro.sql`

El dump `database/bdtexpro.sql` contiene estas tablas:
- `factura_compartida`
- `tasas_descuentos`
- `usuario_permiso`
- `usuario_vendedor`
- `vendedor_meta`
- `usuario`

Importante:
- El dump no contiene tablas de administración como `menu`, `perfil`, `usuario_menu`, `perfil_menu` ni `usuario_perfil`.
- Tampoco contiene `area`, `alertas`, `alerta_destinatarios`, `notificaciones`, `conversacion`, `conversacion_participante`, `mensaje` ni `reporte_venta_compartida_confirmacion`.
- Esas tablas existen en migraciones del repositorio y se usan desde el código.

## 3. Tabla detectada con error de clasificación

Tabla: `menu`  
Fuente: `database/migrations/crear_tablas_admin.sql`, `src/database/rrhh_reportes_compartidos_migration.sql`

Hallazgo:
- `rrhh` estaba registrado con `grupo = 'General'` en un seed/migración previa.
- Eso hace que la sidebar lo agrupe bajo General.

SQL correctivo sugerido:

```sql
UPDATE menu
SET grupo = 'RRHH',
    nombre = 'RRHH',
    url = '/src/modulo/rrhh/rrhh/index.html',
    icono = '👥',
    orden = 1,
    activo = 1
WHERE codigo = 'rrhh';

INSERT INTO menu (
  codigo,
  nombre,
  grupo,
  url,
  icono,
  orden,
  activo
)
VALUES (
  'rrhh_reportes_compartidos',
  'Revisión ventas compartidas',
  'RRHH',
  '/src/modulo/rrhh/reportes-compartidos/index.html',
  '📄',
  2,
  1
)
ON DUPLICATE KEY UPDATE
  nombre = VALUES(nombre),
  grupo = VALUES(grupo),
  url = VALUES(url),
  icono = VALUES(icono),
  orden = VALUES(orden),
  activo = VALUES(activo);
```

## 4. Tabla por tabla

### `factura_compartida`

Columnas:
- `id`
- `folio`
- `anio`
- `mes`
- `fecha`
- `cliente`
- `monto_neto`
- `monto_asignado`
- `porcentaje`
- `rol`
- `cod_vendedor_principal`
- `cod_vendedor_compartido`
- `nombre_vendedor_compartido`
- `fecha_registro`
- `usuario_id`

Uso detectado:
- `src/routes/ventas.js`
- `src/utils/pdfConfirmacion.js`
- `src/modulo/ventas/dashboard/dashboard.js`
- `src/modulo/ventas/ventas/ventas.js`
- `src/models/notificacion.js`
- `tests/routes/*`

Clasificación:
- `usada_en_codigo`: sí
- `tipo_uso`: SELECT, INSERT, JOIN, frontend/campo JSON
- `riesgo_eliminacion`: no eliminar
- `observacion`: tabla crítica para ventas compartidas y reportes.

### `tasas_descuentos`

Columnas:
- `id`
- `anio`
- `fecha_corte`
- `porcentaje`
- `orden`

Uso detectado:
- `src/routes/ventas.js`
- `src/modulo/ventas/dashboard/dashboard.js`

Clasificación:
- `usada_en_codigo`: sí
- `tipo_uso`: SELECT
- `riesgo_eliminacion`: no eliminar
- `observacion`: base para cálculo/visualización de descuentos.

### `usuario_permiso`

Columnas:
- `id`
- `permiso`
- `usuario_id`

Uso detectado:
- `src/routes/auth.js` de forma indirecta mediante payload y permisos consolidados.
- Tests de auth y admin.

Clasificación:
- `usada_en_codigo`: indirecta/probable
- `tipo_uso`: JOIN, test
- `riesgo_eliminacion`: alto
- `observacion`: aunque no siempre se vea en queries directas, forma parte del control de acceso.

### `usuario_vendedor`

Columnas:
- `id`
- `cod_vendedor`
- `tipo`
- `usuario_id`

Uso detectado:
- `src/routes/auth.js`
- `src/models/notificacion.js`
- `src/routes/ventas.js`
- `src/models/usuario.js`
- `src/routes/rrhh.js`
- `src/models/vendedorMeta.js`
- `src/realtime/setup.js`
- tests de auth, ventas, dashboard y RRHH

Clasificación:
- `usada_en_codigo`: sí
- `tipo_uso`: SELECT, JOIN, INSERT, test
- `riesgo_eliminacion`: no eliminar
- `observacion`: relación clave entre usuario y código de vendedor.

### `vendedor_meta`

Columnas del dump:
- `id`
- `fecha`
- `meta`
- `usuario_id`

Columnas agregadas por migración:
- `tipo_periodo`
- `activo`
- `observacion`
- `created_at`
- `updated_at`

Uso detectado:
- `src/models/vendedorMeta.js`
- `src/routes/ventas.js`
- `src/modulo/admin/admin/vendedor-metas.js`
- `tests/routes/*`

Clasificación:
- `usada_en_codigo`: sí
- `tipo_uso`: SELECT, INSERT, UPDATE, JOIN, frontend/campo JSON, migración, test
- `riesgo_eliminacion`: no eliminar
- `observacion`: tabla central de metas; la migración de periodo mensual/anual es crítica.

### `usuario`

Columnas:
- `id`
- `password`
- `last_login`
- `nombre`
- `email`
- `area`
- `codigo`
- `tema`
- `is_active`
- `is_admin`
- `fecha_creacion`

Uso detectado:
- `src/routes/auth.js`
- `src/routes/admin.js`
- `src/models/usuario.js`
- `src/models/mensajeria.js`
- `src/realtime/setup.js`
- `src/middlewares/requireAuth.js`
- `src/utils/jwt.js`
- `src/routes/ventas.js`
- `src/routes/rrhh.js`
- `src/routes/notificaciones.js`
- tests de auth, admin, login, mensajería, RRHH, dashboard y ventas

Clasificación:
- `usada_en_codigo`: sí
- `tipo_uso`: SELECT, UPDATE, JOIN, frontend/campo JSON, test
- `riesgo_eliminacion`: no eliminar
- `observacion`: tabla raíz del sistema de autenticación y perfilamiento.

## 5. Tablas soportadas por migraciones y código

### `menu`

Columnas:
- `id`
- `codigo`
- `nombre`
- `url`
- `icono`
- `grupo`
- `orden`
- `activo`

Uso confirmado:
- `src/routes/auth.js`
- `src/assets/js/app-sidebar.js`
- `src/routes/admin.js`
- `tests/routes/auth.test.js`
- `tests/assets/app-sidebar.test.js`

Clasificación:
- `usada_en_codigo`: sí
- `tipo_uso`: SELECT, INSERT, UPDATE, JOIN, frontend/campo JSON, test
- `riesgo_eliminacion`: no eliminar

### `perfil`

Columnas:
- `id`
- `codigo`
- `nombre`
- `descripcion`
- `area`
- `es_base`
- `activo`

Uso confirmado:
- `src/routes/auth.js`
- `src/routes/admin.js`
- `src/database/perfiles_area_es_base_migration.sql`
- `tests/routes/auth.test.js`

Clasificación:
- `usada_en_codigo`: sí
- `tipo_uso`: SELECT, INSERT, UPDATE, JOIN, migración, test
- `riesgo_eliminacion`: no eliminar

### `usuario_menu`

Columnas:
- `usuario_id`
- `menu_id`
- `activo`

Uso confirmado:
- `src/routes/auth.js`
- `src/database/rrhh_reportes_compartidos_migration.sql`

Clasificación:
- `usada_en_codigo`: sí
- `tipo_uso`: SELECT, INSERT, JOIN, migración
- `riesgo_eliminacion`: no eliminar

### `perfil_menu`

Columnas:
- `perfil_id`
- `menu_id`
- `activo`

Uso confirmado:
- `src/routes/auth.js`
- `src/database/rrhh_reportes_compartidos_migration.sql`

Clasificación:
- `usada_en_codigo`: sí
- `tipo_uso`: SELECT, INSERT, JOIN, migración
- `riesgo_eliminacion`: no eliminar

### `usuario_perfil`

Columnas:
- `usuario_id`
- `perfil_id`
- `activo`

Uso confirmado:
- `src/routes/auth.js`
- `src/database/rrhh_reportes_compartidos_migration.sql`

Clasificación:
- `usada_en_codigo`: sí
- `tipo_uso`: SELECT, INSERT, JOIN, migración
- `riesgo_eliminacion`: no eliminar

### `area`

Columnas:
- `id`
- `codigo`
- `nombre`
- `descripcion`
- `perfil_base_id`
- `activo`
- `created_at`
- `updated_at`

Uso confirmado:
- `src/routes/admin.js`
- `src/routes/auth.js`
- `src/models/mensajeria.js`
- `src/modulo/admin/admin/vendedor-metas.js`
- `tests/assets/admin.test.js`

Clasificación:
- `usada_en_codigo`: sí
- `tipo_uso`: SELECT, INSERT, UPDATE, JOIN, frontend/campo JSON, test, migración
- `riesgo_eliminacion`: no eliminar
- `observacion`: `perfil_base_id` aparece en migración, pero el vínculo todavía parece ser parcialmente de aplicación y migración.

### `usuario_vendedor`

Columnas:
- `id`
- `cod_vendedor`
- `tipo`
- `usuario_id`

Uso confirmado:
- `src/routes/auth.js`
- `src/models/notificacion.js`
- `src/routes/ventas.js`
- `src/routes/rrhh.js`
- `src/models/vendedorMeta.js`
- `src/models/usuario.js`
- `src/realtime/setup.js`

Clasificación:
- `usada_en_codigo`: sí
- `tipo_uso`: SELECT, INSERT, JOIN, test
- `riesgo_eliminacion`: no eliminar

### `reporte_venta_compartida_confirmacion`

Columnas:
- `id`
- `vendedor_usuario_id`
- `vendedor_nombre`
- `vendedor_email`
- `anio`
- `mes`
- `periodo_label`
- `total_venta`
- `total_venta_real`
- `total_descuento`
- `total_comision`
- `cantidad_folios`
- `cantidad_lineas`
- `reporte_json`
- `reporte_pdf_path`
- `estado`
- `confirmado_por`
- `confirmado_at`
- `revisado_por`
- `revisado_at`
- `comentario_rrhh`
- `rechazado_por`
- `rechazado_at`
- `motivo_rechazo`
- `created_at`
- `updated_at`

Uso confirmado:
- `src/models/reporteCompartido.js`
- `src/routes/ventas.js`
- `src/routes/rrhh.js`
- `tests/routes/rrhh.test.js`
- `tests/routes/ventas-compartidas.test.js`

Clasificación:
- `usada_en_codigo`: sí
- `tipo_uso`: SELECT, INSERT, UPDATE, JOIN, frontend/campo JSON, test
- `riesgo_eliminacion`: no eliminar

### `alertas`

Columnas:
- `id`
- `titulo`
- `descripcion`
- `tipo`
- `fecha_vence`
- `frecuencia_recordatorio`
- `id_creador`
- `activa`
- `completada`
- `created_at`
- `updated_at`

Uso confirmado:
- `src/routes/alertas.js`
- `src/modulo/ventas/dashboard/notificaciones-ui.js`
- `tests/routes/alertas.test.js`

Clasificación:
- `usada_en_codigo`: sí
- `tipo_uso`: SELECT, INSERT, UPDATE, JOIN, frontend/campo JSON, test
- `riesgo_eliminacion`: no eliminar

### `alerta_destinatarios`

Columnas:
- `id`
- `id_alerta`
- `id_usuario`
- `descartada_hoy`
- `silenciada`
- `ultimo_recordatorio`

Uso confirmado:
- `src/routes/alertas.js`
- `tests/routes/alertas.test.js`

Clasificación:
- `usada_en_codigo`: sí
- `tipo_uso`: SELECT, INSERT, UPDATE, JOIN, test
- `riesgo_eliminacion`: no eliminar

### `conversacion`

Columnas:
- `id`
- `tipo`
- `titulo`
- `area_codigo`
- `creado_por`
- `activo`
- `created_at`
- `updated_at`

Uso confirmado:
- `src/models/mensajeria.js`
- `src/routes/mensajeria.js`
- `src/assets/js/app-sidebar.js` cuando mensajería está habilitada
- `src/assets/js/indicadores-header.js` cuando mensajería está habilitada
- `tests/routes/mensajeria.test.js`

Clasificación:
- `usada_en_codigo`: sí
- `tipo_uso`: SELECT, INSERT, UPDATE, JOIN, frontend/campo JSON, test
- `riesgo_eliminacion`: no eliminar

### `conversacion_participante`

Columnas:
- `conversacion_id`
- `usuario_id`
- `rol`
- `silenciada`
- `archivada`
- `ultimo_leido_mensaje_id`
- `created_at`

Uso confirmado:
- `src/models/mensajeria.js`
- `src/routes/mensajeria.js`
- `tests/routes/mensajeria.test.js`

Clasificación:
- `usada_en_codigo`: sí
- `tipo_uso`: SELECT, INSERT, UPDATE, JOIN, test
- `riesgo_eliminacion`: no eliminar

### `mensaje`

Columnas:
- `id`
- `conversacion_id`
- `remitente_id`
- `cuerpo`
- `tipo`
- `eliminado`
- `created_at`
- `editado_at`

Uso confirmado:
- `src/models/mensajeria.js`
- `src/routes/mensajeria.js`
- `src/assets/js/app-sidebar.js` cuando mensajería está habilitada
- `src/assets/js/indicadores-header.js` cuando mensajería está habilitada
- `tests/routes/mensajeria.test.js`

Clasificación:
- `usada_en_codigo`: sí
- `tipo_uso`: SELECT, INSERT, UPDATE, JOIN, frontend/campo JSON, test
- `riesgo_eliminacion`: no eliminar

### `notificaciones`

Columnas:
- `id`
- `usuario_id`
- `tipo`
- `titulo`
- `mensaje`
- `leida`
- `folio`
- `mes`
- `anio`
- `fecha_creacion`

Uso confirmado:
- `src/models/notificacion.js`
- `src/routes/notificaciones.js`
- `src/modulo/ventas/dashboard/notificaciones-ui.js`
- `tests/routes/notificaciones.test.js`

Clasificación:
- `usada_en_codigo`: sí
- `tipo_uso`: SELECT, INSERT, UPDATE, JOIN, frontend/campo JSON, test
- `riesgo_eliminacion`: no eliminar

### `usuario_permiso`

Columna duplicada en este informe por ser crítica:
- `id`
- `permiso`
- `usuario_id`

Uso:
- control de permisos adicionales por usuario.

Clasificación:
- `riesgo_eliminacion`: alto

## 6. Columnas con uso confirmado

### Confirmadas como usadas de forma directa o altamente visible
- `menu.codigo`
- `menu.nombre`
- `menu.url`
- `menu.icono`
- `menu.grupo`
- `menu.orden`
- `menu.activo`
- `perfil.codigo`
- `perfil.nombre`
- `perfil.descripcion`
- `perfil.area`
- `perfil.es_base`
- `perfil.activo`
- `usuario.id`
- `usuario.password`
- `usuario.last_login`
- `usuario.nombre`
- `usuario.email`
- `usuario.area`
- `usuario.codigo`
- `usuario.tema`
- `usuario.is_active`
- `usuario.is_admin`
- `usuario.fecha_creacion`
- `usuario_vendedor.cod_vendedor`
- `usuario_vendedor.tipo`
- `usuario_vendedor.usuario_id`
- `vendedor_meta.fecha`
- `vendedor_meta.meta`
- `vendedor_meta.usuario_id`
- `vendedor_meta.tipo_periodo`
- `vendedor_meta.activo`
- `vendedor_meta.observacion`
- `factura_compartida.folio`
- `factura_compartida.anio`
- `factura_compartida.mes`
- `factura_compartida.fecha`
- `factura_compartida.cliente`
- `factura_compartida.monto_neto`
- `factura_compartida.monto_asignado`
- `factura_compartida.porcentaje`
- `factura_compartida.rol`
- `factura_compartida.cod_vendedor_principal`
- `factura_compartida.cod_vendedor_compartido`
- `factura_compartida.nombre_vendedor_compartido`
- `factura_compartida.fecha_registro`
- `factura_compartida.usuario_id`
- `reporte_venta_compartida_confirmacion.vendedor_usuario_id`
- `reporte_venta_compartida_confirmacion.anio`
- `reporte_venta_compartida_confirmacion.mes`
- `reporte_venta_compartida_confirmacion.reporte_json`
- `reporte_venta_compartida_confirmacion.estado`
- `reporte_venta_compartida_confirmacion.confirmado_por`
- `reporte_venta_compartida_confirmacion.confirmado_at`
- `reporte_venta_compartida_confirmacion.revisado_por`
- `reporte_venta_compartida_confirmacion.revisado_at`
- `reporte_venta_compartida_confirmacion.comentario_rrhh`
- `reporte_venta_compartida_confirmacion.rechazado_por`
- `reporte_venta_compartida_confirmacion.rechazado_at`
- `reporte_venta_compartida_confirmacion.motivo_rechazo`
- `area.codigo`
- `area.nombre`
- `area.descripcion`
- `area.perfil_base_id`
- `area.activo`
- `alertas.titulo`
- `alertas.descripcion`
- `alertas.tipo`
- `alertas.fecha_vence`
- `alertas.frecuencia_recordatorio`
- `alertas.id_creador`
- `alertas.activa`
- `alertas.completada`
- `alerta_destinatarios.id_alerta`
- `alerta_destinatarios.id_usuario`
- `alerta_destinatarios.silenciada`
- `alerta_destinatarios.ultimo_recordatorio`
- `conversacion.tipo`
- `conversacion.titulo`
- `conversacion.area_codigo`
- `conversacion.creado_por`
- `conversacion.activo`
- `conversacion_participante.rol`
- `conversacion_participante.silenciada`
- `conversacion_participante.archivada`
- `conversacion_participante.ultimo_leido_mensaje_id`
- `mensaje.conversacion_id`
- `mensaje.remitente_id`
- `mensaje.cuerpo`
- `mensaje.tipo`
- `mensaje.eliminado`
- `notificaciones.usuario_id`
- `notificaciones.tipo`
- `notificaciones.titulo`
- `notificaciones.mensaje`
- `notificaciones.leida`
- `notificaciones.folio`
- `notificaciones.mes`
- `notificaciones.anio`
- `notificaciones.fecha_creacion`

## 7. Columnas sin uso directo encontrado

Importante:
- La ausencia de coincidencia textual no significa que una columna sea segura para borrar.
- Estas columnas quedan como `no directa / requiere validación manual`.

Ejemplos que quedaron en esa categoría:
- `usuario.tema`
- `usuario.codigo` en algunos flujos, porque también se usa como login/código interno en distintos módulos.
- `area.perfil_base_id` en parte del flujo aún parece estar en transición entre migración y aplicación.
- `reporte_venta_compartida_confirmacion.reporte_pdf_path`
- `conversacion.updated_at`
- `conversacion_participante.created_at`
- `mensaje.editado_at`
- `alertas.updated_at`

## 8. Columnas que no se deben eliminar

No eliminar:
- ninguna columna de `menu`
- ninguna columna de `usuario`
- ninguna columna de `usuario_vendedor`
- ninguna columna de `vendedor_meta`
- ninguna columna de `reporte_venta_compartida_confirmacion`
- ninguna columna de `area`
- ninguna columna de `alertas`
- ninguna columna de `alerta_destinatarios`
- ninguna columna de `conversacion`
- ninguna columna de `conversacion_participante`
- ninguna columna de `mensaje`
- ninguna columna de `notificaciones`

Motivo:
- El código actual usa estas tablas en autenticación, sidebar, dashboard, ventas, RRHH, mensajería, alertas y admin.
- Muchas relaciones son indirectas y podrían romperse aunque una búsqueda simple no las encuentre.

## 9. Recomendaciones

1. Mantener `RRHH` como grupo independiente en catálogo y sidebar.
2. Mantener `General` como grupo distinto y no reutilizarlo para RRHH.
3. No borrar columnas por ausencia de coincidencia textual.
4. Si se quiere limpiar esquema, hacerlo solo después de pruebas en un ambiente de ensayo.
5. Para columnas aparentemente no usadas, primero revisar modelos, rutas, migraciones y payloads JSON.
6. Documentar cualquier columna agregada por migración para evitar confusión futura.

## 10. SQL correctivo para RRHH

```sql
UPDATE menu
SET grupo = 'RRHH',
    nombre = 'RRHH',
    url = '/src/modulo/rrhh/rrhh/index.html',
    icono = '👥',
    orden = 1,
    activo = 1
WHERE codigo = 'rrhh';

INSERT INTO menu (
  codigo,
  nombre,
  grupo,
  url,
  icono,
  orden,
  activo
)
VALUES (
  'rrhh_reportes_compartidos',
  'Revisión ventas compartidas',
  'RRHH',
  '/src/modulo/rrhh/reportes-compartidos/index.html',
  '📄',
  2,
  1
)
ON DUPLICATE KEY UPDATE
  nombre = VALUES(nombre),
  grupo = VALUES(grupo),
  url = VALUES(url),
  icono = VALUES(icono),
  orden = VALUES(orden),
  activo = VALUES(activo);
```

## 11. Advertencia final

No eliminar columnas sin respaldo y validación en ambiente de pruebas.
