# Auditoría de migración PHP

Repositorio: `https://github.com/InformaticaTexpro/ClonPHPRSProyecto`

Rama observada: `release/v1.0`

Fecha de auditoría: `2026-08-03`

## Criterios usados

- Se comparó el backend histórico de Node.js (`src/server.js`, `src/routes/*.js`, `src/models/*.js`) con la API PHP actual (`api/index.php`, `api/src/*.php`).
- Se validaron los consumidores reales del frontend mediante `fetch()` y referencias internas.
- Se marcaron como duplicadas las rutas PHP que tienen dos implementaciones activas o una implementación activa y otra inalcanzable.
- Se marcó como obsoleto todo lo que no tiene consumo real o quedó reemplazado por otra capa.

## Matriz de equivalencia

| Módulo | Método HTTP | Ruta | Implementación Node | Implementación PHP | Archivo frontend consumidor | Estado | Diferencias de respuesta | Acción requerida |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| auth | POST | `/api/auth/login` | `src/routes/auth.js` | `api/src/AuthService.php::login()` | `src/modulo/varios/login/login.js` | Migrado y equivalente | Conserva `ok`, `token` y `user` | Mantener y probar login real |
| auth | GET | `/api/auth/me` | `src/routes/auth.js` | `api/src/AuthService.php::me()` | `src/assets/js/app-sidebar.js`, `src/modulo/general/general/general.js`, `src/modulo/rrhh/rrhh/rrhh.js`, `src/modulo/ventas/dashboard/dashboard.js`, `src/modulo/ventas/historial-cliente/historial.js`, `src/modulo/varios/sin-acceso/sin-acceso.js` | Migrado y equivalente | Perfil y menús con estructura compatible | Mantener |
| auth | POST | `/api/auth/refresh` | `src/routes/auth.js` | `api/src/AuthService.php::refresh()` | Frontend indirecto | Migrado con diferencias | Refresh sin estrategia de refresh token separada | Documentar comportamiento y validar expiración |
| auth | POST | `/api/auth/logout` | `src/routes/auth.js` | `api/index.php` respuesta simple | Frontend indirecto | Migrado con diferencias | No invalida token del lado servidor | Definir si se necesita blacklist o cierre simbólico |
| auth | POST | `/api/auth/recuperar` | `src/routes/recuperar.js` | `api/src/RecoveryService.php::request_reset()` | `src/modulo/varios/recuperar-password/recuperar.js` | Migrado y equivalente | Flujo compatible por correo/OTP | Mantener |
| auth | POST | `/api/auth/verificar-otp` | `src/routes/recuperar.js` | `api/src/RecoveryService.php::verify_otp()` | `src/modulo/varios/recuperar-password/recuperar.js` | Migrado y equivalente | Misma validación de OTP | Mantener |
| auth | POST | `/api/auth/nueva-password` | `src/routes/recuperar.js` | `api/src/RecoveryService.php::set_new_password()` | `src/modulo/varios/recuperar-password/recuperar.js` | Migrado y equivalente | Compatible con recuperación | Mantener |
| salud | GET | `/api/health` | `src/server.js` | `api/index.php` | Validación manual y hosting | Migrado con diferencias | PHP reporta `app`, `db` y código 503/200; no expone entorno | Añadir detalle de entorno y chequeo Softland controlado |
| indicadores | GET | `/api/indicadores` | `src/routes/indicadores.js` | `api/src/IndicadoresService.php::get()` | `src/assets/js/indicadores-header.js` | Migrado y equivalente | PHP usa caché local y `curl` | Mantener |
| dashboard | GET | `/api/dashboard/resumen` | `src/routes/dashboard.ajustes.js` | `api/src/AnalyticsService.php::resumen()` | `src/modulo/ventas/dashboard/dashboard.js` | Migrado y equivalente | KPIs con mismos nombres esperados | Mantener |
| dashboard | GET | `/api/dashboard/evolucion` | `src/routes/dashboard.ajustes.js` | `api/src/AnalyticsService.php::evolucion()` | `src/modulo/ventas/dashboard/dashboard.js` | Migrado y equivalente | Serie mensual compatible | Mantener |
| dashboard | GET | `/api/dashboard/vendedores` | `src/routes/dashboard.ajustes.js` | `api/src/AnalyticsService.php::vendedores()` | `src/modulo/ventas/dashboard/dashboard.js` | Migrado y equivalente | Totales y porcentaje de descuento calculados en PHP | Mantener |
| dashboard | GET | `/api/dashboard/ventas-mes` | `src/routes/dashboard.ajustes.js` | `api/src/AnalyticsService.php::ventasMes()` + `api/index.php` | `src/modulo/ventas/dashboard/dashboard.js`, `src/modulo/ventas/ventas/ventas.js`, `src/assets/js/indicadores-header.js` | Migrado con diferencias | Antes devolvía descuento en cero; ahora se calcula desde lista vs cobrado | Validar con Softland real y comparar con Node |
| dashboard | GET | `/api/dashboard/detalle/{folio}` | `src/server.js` + `src/models/venta.js` | `api/src/AnalyticsService.php::detalleFolio()` | `src/modulo/ventas/dashboard/dashboard.js` | Migrado con diferencias | PHP calcula `precio_real`, `neto_real`, `dcto`; la versión Node usaba otra capa de detalle | Validar fórmula contra Node antes de borrar compatibilidad |
| dashboard | GET | `/api/ventas/detalle/{folio}` | `src/routes/ventas.js` + `src/models/venta.js` | `api/src/AnalyticsService.php::detalleFolio()` | `src/modulo/ventas/ventas/ventas.js` | Duplicado | Misma lógica de detalle expuesta por dos rutas distintas | Unificar una sola ruta canónica |
| dashboard | GET | `/api/dashboard/vendedores-todos` | `src/routes/dashboard.panel.js` | `api/src/AnalyticsService.php::vendedoresTodos()` | `src/modulo/ventas/ventas/ventas.js` | Migrado y equivalente | Lista de vendedores para sharing | Mantener |
| dashboard | GET | `/api/dashboard/compartidos` | `src/routes/dashboard.panel.js` | `api/src/AnalyticsService.php::compartidos()` y `api/index.php` | `src/modulo/ventas/ventas/ventas.js`, `src/assets/js/indicadores-header.js` | Duplicado | Hay lógica paralela en `AnalyticsService` y `DashboardService`; una queda inalcanzable para GET | Consolidar una sola implementación |
| dashboard | GET | `/api/dashboard/asignados` | `src/routes/dashboard.panel.js` | `api/src/AnalyticsService.php::asignados()` y `api/src/DashboardService.php::asignados()` | `src/modulo/ventas/ventas/ventas.js`, `src/assets/js/indicadores-header.js` | Duplicado | `AnalyticsService` responde primero; `DashboardService` queda oculta para GET | Elegir una implementación y borrar la otra |
| dashboard | GET | `/api/dashboard/compartir/lista` | `src/routes/dashboard.panel.js` | `api/src/AnalyticsService.php::compartirLista()` y `api/src/DashboardService.php::compartirLista()` | `src/modulo/ventas/ventas/ventas.js` | Duplicado | GET queda absorbido por `AnalyticsService`; `DashboardService` queda parcialmente relegada a mutaciones | Unificar criterio y eliminar la ruta duplicada |
| dashboard | GET | `/api/dashboard/categorias-vendedor` | `src/routes/dashboard.panel.js` | `api/src/AnalyticsService.php::categoriasVendedor()` y `api/src/DashboardService.php::categoriasVendedor()` | `src/assets/js/indicadores-header.js`, `src/modulo/ventas/dashboard/dashboard.js` | Duplicado | La primera rama de `api/index.php` responde antes | Consolidar |
| dashboard | GET | `/api/dashboard/clientes-resumen` | `src/routes/dashboard.panel.js` | `api/src/AnalyticsService.php::clientesResumen()` y `api/src/DashboardService.php::clientesResumen()` | `src/modulo/ventas/dashboard/dashboard.js`, `src/assets/js/indicadores-header.js` | Duplicado | Misma salida, doble ruta lógica | Consolidar |
| cartera | GET | `/api/cartera` | `src/routes/cartera.js` | `api/src/AnalyticsService.php::cartera()` | `src/modulo/ventas/dashboard/dashboard.js` | Migrado y equivalente | Estructura de KPIs y listados compatible | Mantener |
| ventas | GET | `/api/ventas/` | `src/routes/ventas.js` | `api/src/VentasService.php::ventas()` | `src/modulo/ventas/ventas/ventas.js` | Migrado y equivalente | Wrapper sobre `ventasMes()` | Mantener |
| ventas | GET | `/api/ventas/kpis` | `src/routes/ventas.js` | `api/src/VentasService.php::kpis()` | `src/modulo/ventas/ventas/ventas.js` | Migrado y equivalente | Calcula cobrado, lista y descuento | Mantener |
| ventas | GET | `/api/ventas/total` | `src/routes/ventas.js` | `api/src/VentasService.php::total()` | `src/modulo/ventas/ventas/ventas.js` | Migrado y equivalente | Total cobrado por período | Mantener |
| ventas | GET | `/api/ventas/resumen` | `src/routes/ventas.js` | `api/src/VentasService.php::resumen()` | `src/modulo/ventas/ventas/ventas.js` | Migrado y equivalente | Mantiene contrato de resumen | Mantener |
| ventas | GET | `/api/ventas/resumen-vendedores` | `src/routes/ventas.js` | `api/src/VentasService.php::resumenVendedores()` | `src/modulo/ventas/ventas/ventas.js` | Migrado y equivalente | Mantiene agrupación por vendedor | Mantener |
| ventas | GET | `/api/ventas/evolucion` | `src/routes/ventas.js` | `api/src/VentasService.php::evolucion()` | `src/modulo/ventas/ventas/ventas.js` | Migrado y equivalente | Serie mensual compatible | Mantener |
| ventas | GET | `/api/ventas/meta` | `src/routes/ventas.js` | `api/src/VentasService.php::meta()` | `src/modulo/ventas/ventas/ventas.js` | Migrado y equivalente | Compatible con metas del módulo | Mantener |
| ventas | GET | `/api/ventas/clientes` | `src/routes/ventas.js` | `api/src/VentasService.php::clientes()` | `src/modulo/ventas/historial-cliente/historial.js` | Migrado y equivalente | Búsqueda por cliente y vendedor | Mantener |
| ventas | GET | `/api/ventas/cliente-info` | `src/routes/ventas.js` | `api/src/VentasService.php::clienteInfo()` | `src/modulo/ventas/historial-cliente/historial.js` | Migrado y equivalente | Devuelve datos Softland del cliente | Mantener |
| ventas | GET | `/api/ventas/historial-cliente` | `src/routes/ventas.js` | `api/src/VentasService.php::historialCliente()` | `src/modulo/ventas/historial-cliente/historial.js` | Migrado y equivalente | Mantiene filtros por fecha | Mantener |
| ventas | GET | `/api/ventas/folio/{folio}` | `src/routes/ventas.js` | `api/src/VentasService.php::folio()` | `src/modulo/ventas/ventas/ventas.js` | Migrado y equivalente | Devuelve subtotal y descuento del encabezado | Mantener |
| ventas | GET | `/api/ventas/detalle/{folio}` | `src/routes/ventas.js` | `api/src/VentasService.php::detalle()` -> `AnalyticsService::detalleFolio()` | `src/modulo/ventas/ventas/ventas.js` | Duplicado | Misma información expuesta por ventas y dashboard | Definir ruta canónica y retirar la duplicada |
| ventas | GET | `/api/ventas/descuentos` | `src/routes/ventas.js` | `api/src/VentasService.php::descuentos()` | `src/modulo/ventas/ventas/ventas.js` | Migrado con diferencias | Campo `data` reutiliza vendedores para descuento global | Validar si el frontend lo sigue consumiendo |
| ventas | GET | `/api/ventas/confirmacion-estado` | `src/routes/ventas.js` + `src/models/confirmacion.js` | `api/src/SalesService.php::confirmacionEstado()` | `src/modulo/ventas/ventas/ventas.js` | Migrado y equivalente | Respuesta de estado de confirmación mensual | Mantener |
| ventas | POST | `/api/ventas/confirmar` | `src/routes/ventas.js` | `api/src/SalesService.php::confirmar()` | `src/modulo/ventas/ventas/ventas.js` | Migrado y equivalente | Genera PDF y registra confirmación | Mantener y probar PDF |
| ventas | GET | `/api/ventas/confirmacion/{id}/pdf` | `src/routes/ventas.js` + `src/utils/pdfConfirmacion.js` | `api/src/SalesService.php::getPdf()` + `api/src/Pdf.php` | `src/modulo/ventas/ventas/ventas.js` | Migrado con diferencias | Ya no depende de Puppeteer; usa PDF PHP | Validar salida visual y permisos |
| ventas | GET | `/api/ventas/compartidas/confirmacion` | `src/routes/ventas.js` | `api/src/SalesService.php::sharedConfirmationState()` | `src/modulo/ventas/ventas/ventas.js` | Migrado y equivalente | Estado de confirmación compartida | Mantener |
| ventas | POST | `/api/ventas/compartidas/confirmar` | `src/routes/ventas.js` | `api/src/SalesService.php::confirmShared()` | `src/modulo/ventas/ventas/ventas.js` | Migrado y equivalente | Guarda snapshot y genera PDF | Mantener |
| ventas | POST/GET/PUT/DELETE | `/api/dashboard/compartir`, `/api/dashboard/compartir/{id}` | `src/routes/dashboard.panel.js` | `api/src/DashboardService.php::compartir()/actualizarCompartido()/eliminarCompartido()` | `src/modulo/ventas/ventas/ventas.js` | Migrado y equivalente | El flujo de compartir sigue vivo por DashboardService | Mantener, pero mover a rutas dedicadas |
| admin | GET/POST/PUT/PATCH/DELETE | `/api/admin/usuarios`, `/api/admin/usuarios/{id}`, `/api/admin/usuarios/{id}/password`, `/api/admin/usuarios/{id}/menus`, `/api/admin/usuarios/{id}/perfiles`, `/api/admin/usuarios/{id}/vendedores` | `src/routes/admin.js` | `api/src/AdminService.php::route()` | `src/modulo/admin/admin/admin.js`, `src/modulo/admin/admin/vendedor-metas.js` | Migrado y equivalente | Contratos de administración amplios conservados | Mantener y segmentar por submódulos |
| admin | GET/POST/PUT/PATCH/DELETE | `/api/admin/menus`, `/api/admin/perfiles`, `/api/admin/areas`, `/api/admin/vendedor-metas`, `/api/admin/accesos/asignar-por-area` | `src/routes/admin.js` | `api/src/AdminService.php::route()` | `src/modulo/admin/admin/admin.js`, `src/modulo/admin/admin/vendedor-metas.js` | Migrado y equivalente | Estructura funcional equivalente | Mantener |
| alertas | GET/POST/PUT/PATCH/DELETE | `/api/alertas`, `/api/alertas/contador`, `/api/alertas/badge`, `/api/alertas/pendientes`, `/api/alertas/usuarios`, `/api/alertas/{id}/completar`, `/desactivar`, `/activar`, `/archivar`, `/desarchivar`, `/descartar`, `/silenciar` | `src/routes/alertas.js` | `api/src/AlertasService.php::route()` | `src/modulo/varios/alertas/alertas.js`, `src/modulo/ventas/dashboard/notificaciones-ui.js`, `src/assets/js/indicadores-header.js`, `src/assets/js/realtime-client.js` | Migrado y equivalente | Reemplazo por polling HTTP, sin Socket.IO | Mantener |
| mensajeria | GET/POST/PATCH | `/api/mensajeria/directorio`, `/conversaciones`, `/conversaciones/{id}/mensajes`, `/conversaciones/{id}/leido`, `/no-leidos`, `/usuarios-online`, `/conversaciones/{id}/archivar`, `/silenciar` | `src/routes/mensajeria.js` | `api/src/MensajeriaService.php::route()` | `src/modulo/varios/mensajeria/mensajeria.js`, `src/assets/js/app-sidebar.js`, `src/assets/js/realtime-client.js` | Migrado y equivalente | `usuarios-online` responde vacío por ahora | Si se requiere tiempo real real, reemplazar por polling más fino |
| notificaciones | GET/PATCH | `/api/notificaciones`, `/api/notificaciones/contador`, `/api/notificaciones/{id}/leer`, `/api/notificaciones/leer-todo` | `src/routes/notificaciones.js` | `api/src/NotificacionesService.php::route()` | `src/modulo/ventas/dashboard/notificaciones-ui.js`, `src/assets/js/indicadores-header.js` | Migrado y equivalente | Contrato mantiene `ok`, `data` y contador | Mantener |
| rrhh | GET | `/api/rrhh/confirmaciones`, `/confirmaciones/{id}/pdf` | `src/routes/rrhh.js` | `api/src/RrhhService.php::route()` | `src/modulo/rrhh/rrhh/rrhh.js` | Migrado y equivalente | PDF servido desde PHP con `Content-Type: application/pdf` | Mantener |
| rrhh | GET/PATCH | `/api/rrhh/reportes-compartidos`, `/reportes-compartidos/{id}`, `/reportes-compartidos/{id}/validar`, `/reportes-compartidos/{id}/rechazar`, `/ventas-compartidas/revision` | `src/routes/rrhh.js` | `api/src/RrhhService.php::route()` | `src/modulo/rrhh/reportes-compartidos/reportes-compartidos.js` | Migrado y equivalente | Conserva flujo de revisión y estados | Mantener |
| vendedores | GET/POST/PUT/DELETE | `/api/vendedores/{id}/contrato`, `/api/vendedores/{id}/rut`, `/api/vendedores/{id}/info` | `src/routes/vendedores.js` | `api/src/VendedoresService.php::route()` | Administración y módulos de vendedor | Migrado y equivalente | Soporta stream de archivo/PDF | Mantener y proteger rutas de archivo |
| infraestructura | N/A | `api/routes/*` | No existía como capa Node separada | No existe aún; todo vive en `api/index.php` | N/A | Parcial | El front controller funciona, pero las rutas no están modularizadas | Extraer `api/routes/*.php` por módulo en fase 3 |
| infraestructura | N/A | `.tools/php/` | No aplica | No aplica | N/A | Obsoleto | Binarios de PHP para Windows quedaron versionados dentro del repo | Eliminar del control de versiones y agregar a `.gitignore` |
| infraestructura | N/A | `socket.io` / WebSocket | `src/realtime/setup.js`, `src/realtime/socketHub.js`, `src/server.js` | No aplica | `src/assets/js/realtime-client.js` hoy hace polling | Obsoleto | Ya no hay uso residual de Socket.IO en la capa PHP | Eliminar runtime Node de realtime y mantener polling HTTP |
| infraestructura | N/A | `puppeteer` | `src/utils/pdfConfirmacion.js` y dependencias antiguas del stack Node | Reemplazado por `api/src/Pdf.php` y `SalesService.php` | Flujos de PDF | Obsoleto | La generación de PDF ya no depende de Node | Retirar dependencias Node de PDF cuando se complete la equivalencia |

## Hallazgos transversales

- La API PHP actual todavía está centralizada en `api/index.php`; la extracción a `api/routes/*.php` sigue pendiente.
- Hay duplicidades reales en:
  - `/api/dashboard/asignados`
  - `/api/dashboard/compartidos`
  - `/api/dashboard/categorias-vendedor`
  - `/api/dashboard/clientes-resumen`
  - `/api/dashboard/compartir/lista`
  - `/api/dashboard/detalle/{folio}` y `/api/ventas/detalle/{folio}`
- El frontend sigue funcionando con polling HTTP para alertas y mensajería, sin `socket.io` activo en runtime.
- No se detectó uso runtime de `puppeteer` en la API PHP actual; los PDFs ya se generan en PHP.
- `.tools/php/` está versionado dentro del repositorio y debe sacarse del control de versiones antes de una entrega final.

## Archivos y artefactos a revisar en la siguiente fase

- `api/index.php`
- `api/src/AnalyticsService.php`
- `api/src/DashboardService.php`
- `api/src/VentasService.php`
- `api/src/SalesService.php`
- `api/src/AlertasService.php`
- `api/src/MensajeriaService.php`
- `api/src/NotificacionesService.php`
- `api/src/RrhhService.php`
- `api/src/VendedoresService.php`
- `.tools/php/`
- `estructura.txt`

