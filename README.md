# RSProyecto â€” Texpro Productos QuÃ­micos y Tratamiento de Aguas

Sistema de centralizaciÃ³n de informaciÃ³n para las Ã¡reas operativas de Texpro.

## MÃ³dulos

| MÃ³dulo         | Estado       |
|----------------|--------------|
| Ventas         | Backend PHP migrado |
| Bodega         | â³ Pendiente |
| ProducciÃ³n     | â³ Pendiente |
| Laboratorio    | â³ Pendiente |
| FacturaciÃ³n    | â³ Pendiente |
| Contabilidad   | â³ Pendiente |
| RRHH           | â³ Pendiente |
| Cobranza       | â³ Pendiente |
| Gerencia       | â³ Pendiente |

## CI/CD

Este proyecto ya no depende de Node para su despliegue. La entrega se realiza directo con PHP.
La capa PHP ya cubre autenticación, dashboard, ventas, alertas, mensajería, RRHH, notificaciones, vendedores e indicadores.

## Stack TecnolÃ³gico

- **Frontend:** HTML5 / CSS3 / JavaScript del navegador
- **Backend:** PHP 8.x

## Backend PHP

La API principal ya corre en PHP dentro de `/api` y estÃ¡ preparada para subirla a un hosting compartido con Apache/PHP como `hn.cl`.

### Arranque local

- En Windows local:
  - `.\.tools\php\php.exe -S 127.0.0.1:8000 -t . router.php` 
- En un entorno con PHP instalado:
  - `php -S 127.0.0.1:8000 -t . router.php`

Los endpoints históricos del backend Node fueron reemplazados por servicios PHP equivalentes y por un front controller único.

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
- ExtensiÃ³n `pdo_mysql`
- ExtensiÃ³n `curl`
- Para Softland: extensiÃ³n `pdo_sqlsrv` o `sqlsrv`
- Acceso saliente HTTPS a Microsoft Graph si se usa recuperaciÃ³n por correo



