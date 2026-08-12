# RSProyecto — Texpro Productos Químicos y Tratamiento de Aguas

Sistema de centralización de información para las áreas operativas de Texpro.

## Módulos

| Módulo         | Estado       |
|----------------|--------------|
| Ventas         | Backend PHP migrado |
| Bodega         | ⏳ Pendiente |
| Producción     | ⏳ Pendiente |
| Laboratorio    | ⏳ Pendiente |
| Facturación    | ⏳ Pendiente |
| Contabilidad   | ⏳ Pendiente |
| RRHH           | ⏳ Pendiente |
| Cobranza       | ⏳ Pendiente |
| Gerencia       | ⏳ Pendiente |

## CI/CD

Este proyecto ya no depende de Node para su despliegue. La entrega se realiza directo con PHP.
La capa PHP ya cubre autenticaci�n, dashboard, ventas, alertas, mensajer�a, RRHH, notificaciones, vendedores e indicadores.

## Stack Tecnológico

- **Frontend:** HTML5 / CSS3 / JavaScript del navegador
- **Backend:** PHP 8.x

## Backend PHP

La API principal ya corre en PHP dentro de `/api` y está preparada para subirla a un hosting compartido con Apache/PHP como `hn.cl`.

### Arranque local

- En Windows local:
  - `.\.tools\php\php.exe -S 127.0.0.1:8000 -t . router.php` 
- En un entorno con PHP instalado:
  - `php -S 127.0.0.1:8000 -t . router.php`

Los endpoints hist�ricos del backend Node fueron reemplazados por servicios PHP equivalentes y por un front controller �nico.

### Rutas principales

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/auth/refresh`
- `POST /api/auth/recuperar`
- `POST /api/auth/verificar-otp`
- `POST /api/auth/nueva-password`
- `GET /api/health`
- `GET /api/indicadores`
- `GET /api/dashboard/*`
- `GET /api/ventas/*`
- `GET /api/admin/*`
- `GET /api/rrhh/*`
- `GET /api/alertas/*`
- `GET /api/mensajeria/*`
- `GET /api/notificaciones/*`
- `GET /api/vendedores/*`

### Requisitos del hosting

- PHP 8.1 o superior
- Extensión `pdo_mysql`
- Extensión `curl`
- Para Softland: extensión `pdo_sqlsrv` o `sqlsrv`
- Acceso saliente HTTPS a Microsoft Graph si se usa recuperación por correo



