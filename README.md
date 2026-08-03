# RSProyecto — Texpro Productos Químicos y Tratamiento de Aguas

Sistema de centralización de información para las áreas operativas de Texpro.

## Módulos

| Módulo         | Estado       |
|----------------|--------------|
| Ventas         | 🚧 En desarrollo |
| Bodega         | ⏳ Pendiente |
| Producción     | ⏳ Pendiente |
| Laboratorio    | ⏳ Pendiente |
| Facturación    | ⏳ Pendiente |
| Contabilidad   | ⏳ Pendiente |
| RRHH           | ⏳ Pendiente |
| Cobranza       | ⏳ Pendiente |
| Gerencia       | ⏳ Pendiente |

## CI/CD

Este proyecto usa **GitHub Actions** para integración continua.

- Lint y formato de código en cada `push` y `pull_request`
- Ejecución de tests automáticos por módulo
- Reporte de cobertura de código

## Stack Tecnológico

- **Frontend:** HTML5 / CSS3 / JavaScript
- **Backend:** PHP 8.x
- **CI:** GitHub Actions
- **Testing:** Jest

## Backend PHP

La API principal ya corre en PHP dentro de `/api` y está preparada para subirla a un hosting compartido con Apache/PHP como `hn.cl`.

### Arranque local

- `npm start` levanta el servidor PHP embebido usando `router.php`
- `npm run dev` usa el mismo arranque local

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
