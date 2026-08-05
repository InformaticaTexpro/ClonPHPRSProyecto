# Guia comentada del codigo - RSProyecto

Esta guia resume la arquitectura actual del proyecto y el estado de la migracion del backend a PHP.

## 1) Vision general

El proyecto esta dividido en:

- Backend PHP en `api/index.php` y `api/src/ApiApplication.php`, con servicios en `api/src`.
- Frontend estatico en `src/modulo` y `src/assets`.
- Acceso a datos:
  - MySQL para usuarios, metas, alertas, mensajes y notificaciones.
  - SQL Server Softland para ventas, folios y detalle comercial.

Flujo principal:

1. El frontend hace login contra `/api/auth/login`.
2. El backend valida la contrasena, emite JWT y devuelve el perfil.
3. El frontend usa el JWT para consumir endpoints protegidos.
4. Los servicios PHP consultan MySQL o Softland segun la funcionalidad.

## 2) Entrada del backend

### `api/index.php`

Responsabilidad:

- Inicializar el backend PHP.
- Configurar CORS.
- Delegar la ejecución a `api/src/ApiApplication.php`.
- Mantener el front controller mínimo.

Datos que consume:

- `api/bootstrap.php`
- Conexiones a MySQL y utilidades compartidas

Datos que expone:

- Endpoints `/api/*`
- `/api/health`

## 3) Servicios PHP

### `api/src/Services.php`

Responsabilidad:

- Login, sesion actual, logout y recuperacion de contrasena.

### `api/src/AnalyticsService.php`

Responsabilidad:

- Resumen de dashboard, evolucion, vendedores, ventas por mes, cartera y detalle comercial.

### `api/src/SalesService.php`

Responsabilidad:

- Confirmacion de ventas y PDFs asociados.

### `api/src/AdminService.php`

Responsabilidad:

- Gestion administrativa de usuarios, menus, perfiles, areas y metas.

### `api/src/RrhhService.php`

Responsabilidad:

- Confirmaciones, reportes compartidos y PDFs de RRHH.

### `api/src/AlertasService.php`

Responsabilidad:

- CRUD y estados de alertas.

### `api/src/MensajeriaService.php`

Responsabilidad:

- Conversaciones, mensajes, directorio y presencia.

### `api/src/NotificacionesService.php`

Responsabilidad:

- Listado, contador y marcacion de notificaciones.

### `api/src/VendedoresService.php`

Responsabilidad:

- Contratos, descarga de PDFs, actualizacion de RUT e info del vendedor.

### `api/src/DashboardService.php`

Responsabilidad:

- Compartir ventas, asignados, categorias y clientes resumen.

### `api/src/VentasService.php`

Responsabilidad:

- Listado de ventas, KPIs, resumenes, historiales y descuentos.

### `api/src/IndicadoresService.php`

Responsabilidad:

- Indicadores economicos para el header y otros widgets del frontend.

## 4) Utilidades PHP

### `api/src/Database.php`

- Crea y reutiliza conexiones a MySQL y Softland.

### `api/src/Security.php`

- Validaciones de negocio, token y parametros sensibles.

### `api/src/Http.php`

- Respuestas JSON, lectura de cuerpos y helpers HTTP.

### `api/src/Pdf.php`

- Generacion y entrega de documentos PDF.

### `api/src/Env.php`

- Carga variables de entorno.

## 5) Arranque local

El proyecto ahora puede levantarse con PHP:

- `.\.tools\php\php.exe -S 127.0.0.1:8000 -t . router.php` 
- o `php -S 127.0.0.1:8000 -t . router.php` si PHP está en el PATH

Ambos usan `router.php`, que enruta:

- `/api/*` hacia `api/index.php`
- el frontend estatico hacia `src/modulo`

## 6) Estado de la migracion

El backend principal ya fue reemplazado por PHP y el arranque Node antiguo fue retirado del repositorio.


