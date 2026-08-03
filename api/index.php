<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

send_cors_headers();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$database = new Database();
$authService = new AuthService($database);
$recoveryService = new RecoveryService($database);
$analyticsService = new AnalyticsService($database);
$salesService = new SalesService($database, $analyticsService);
$adminService = new AdminService($database);
$rrhhService = new RrhhService($database);
$alertasService = new AlertasService($database);
$mensajeriaService = new MensajeriaService($database);
$notificacionesService = new NotificacionesService($database);
$vendedoresService = new VendedoresService($database);
$dashboardService = new DashboardService($database);
$ventasService = new VentasService($database, $analyticsService);
$indicadoresService = new IndicadoresService();

$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$path = normalize_api_path((string)parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));



function dispatch_prefixed_route(string $path, string $prefix): string
{
    if ($path === $prefix) {
        return '/';
    }
    if (str_starts_with($path, $prefix . '/')) {
        $subpath = substr($path, strlen($prefix));
        return $subpath === '' ? '/' : $subpath;
    }
    return $path;
}

try {
    if ($method === 'GET' && $path === '/') {
        json_response([
            'ok' => true,
            'app' => 'RSProyecto',
            'backend' => 'php',
            'message' => 'API PHP activa',
        ]);
    }

    if ($method === 'GET' && $path === '/health') {
        try {
            $database->test_mysql_connection();
            json_response(['ok' => true, 'app' => 'RSProyecto', 'db' => 'connected']);
        } catch (Throwable $e) {
            json_response([
                'ok' => false,
                'app' => 'RSProyecto',
                'db' => 'disconnected',
                'error' => 'Base de datos no disponible',
            ], 503);
        }
    }
    if ($method === 'GET' && $path === '/indicadores') {
        json_response($indicadoresService->get($_GET));
    }
    if ($method === 'POST' && $path === '/auth/login') {
        $body = read_json_body();
        $login = $body['email'] ?? $body['usuario'] ?? null;
        $result = $authService->login((string)$login, (string)($body['password'] ?? ''));
        json_response($result);
    }

    if ($method === 'GET' && $path === '/auth/me') {
        $token = require_bearer_token();
        $result = $authService->me($token);
        json_response($result);
    }

    if ($method === 'POST' && $path === '/auth/logout') {
        require_bearer_token();
        json_response(['ok' => true, 'message' => 'Sesión cerrada']);
    }

    if ($method === 'POST' && $path === '/auth/refresh') {
        $token = require_bearer_token();
        $result = $authService->refresh($token);
        json_response($result);
    }

    if ($method === 'POST' && $path === '/auth/recuperar') {
        $body = read_json_body();
        $result = $recoveryService->request_reset((string)($body['email'] ?? ''));
        json_response($result);
    }

    if ($method === 'POST' && $path === '/auth/verificar-otp') {
        $body = read_json_body();
        $result = $recoveryService->verify_otp((string)($body['email'] ?? ''), (string)($body['otp'] ?? ''));
        json_response($result);
    }

    if ($method === 'POST' && $path === '/auth/nueva-password') {
        $body = read_json_body();
        $result = $recoveryService->set_new_password((string)($body['resetToken'] ?? ''), (string)($body['password'] ?? ''));
        json_response($result);
    }

    if (str_starts_with($path, '/admin')) {
        $body = in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true) ? read_json_body() : [];
        $subpath = dispatch_prefixed_route($path, '/admin');
        json_response($adminService->route(require_auth_payload(), $method, $subpath, $_GET, $body));
    }

    if (str_starts_with($path, '/rrhh')) {
        $body = in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true) ? read_json_body() : [];
        $subpath = dispatch_prefixed_route($path, '/rrhh');
        $result = $rrhhService->route(require_auth_payload(), $method, $subpath, $_GET, $body);
        if ($method === 'GET' && preg_match('#^/confirmaciones/(\d+)/pdf$#', $subpath, $matches)) {
            header('Content-Type: application/pdf');
            header('Content-Disposition: inline; filename="' . $result['filename'] . '"');
            echo $result['bytes'];
            exit;
        }
        json_response($result);
    }

    if (str_starts_with($path, '/alertas')) {
        $body = in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true) ? read_json_body() : [];
        $subpath = dispatch_prefixed_route($path, '/alertas');
        json_response($alertasService->route(require_auth_payload(), $method, $subpath, $_GET, $body));
    }

    if (str_starts_with($path, '/mensajeria')) {
        $body = in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true) ? read_json_body() : [];
        $subpath = dispatch_prefixed_route($path, '/mensajeria');
        json_response($mensajeriaService->route(require_auth_payload(), $method, $subpath, $_GET, $body));
    }

    if ($method === 'GET' && $path === '/dashboard/resumen') {
        json_response($analyticsService->resumen(require_auth_payload(), $_GET));
    }

    if ($method === 'GET' && $path === '/dashboard/evolucion') {
        json_response($analyticsService->evolucion(require_auth_payload(), $_GET));
    }

    if ($method === 'GET' && $path === '/dashboard/vendedores') {
        json_response($analyticsService->vendedores(require_auth_payload(), $_GET));
    }

    if ($method === 'GET' && $path === '/dashboard/ventas-mes') {
        json_response($analyticsService->ventasMes(require_auth_payload(), $_GET));
    }

    if ($method === 'GET' && preg_match('#^/dashboard/detalle/(\d+)$#', $path, $matches)) {
        json_response($analyticsService->detalleFolio(require_auth_payload(), (int)$matches[1]));
    }

    if ($method === 'GET' && preg_match('#^/ventas/detalle/(\d+)$#', $path, $matches)) {
        json_response($analyticsService->detalleFolio(require_auth_payload(), (int)$matches[1]));
    }

    if ($method === 'GET' && $path === '/dashboard/vendedores-todos') {
        json_response($analyticsService->vendedoresTodos(require_auth_payload()));
    }

    if ($method === 'GET' && $path === '/dashboard/compartidos') {
        json_response($analyticsService->compartidos(require_auth_payload(), $_GET));
    }

    if ($method === 'GET' && $path === '/dashboard/asignados') {
        json_response($analyticsService->asignados(require_auth_payload(), $_GET));
    }

    if ($method === 'GET' && $path === '/dashboard/compartir/lista') {
        json_response($analyticsService->compartirLista(require_auth_payload(), $_GET));
    }

    if ($method === 'GET' && $path === '/dashboard/categorias-vendedor') {
        json_response($analyticsService->categoriasVendedor(require_auth_payload(), $_GET));
    }

    if ($method === 'GET' && $path === '/dashboard/clientes-resumen') {
        json_response($analyticsService->clientesResumen(require_auth_payload(), $_GET));
    }

    if ($method === 'GET' && $path === '/cartera') {
        json_response($analyticsService->cartera(require_auth_payload(), $_GET));
    }

    if ($method === 'GET' && $path === '/ventas/confirmacion-estado') {
        json_response($salesService->confirmacionEstado(require_auth_payload(), $_GET));
    }

    if ($method === 'POST' && $path === '/ventas/confirmar') {
        json_response($salesService->confirmar(require_auth_payload(), read_json_body()));
    }

    if ($method === 'GET' && preg_match('#^/ventas/confirmacion/(\d+)/pdf$#', $path, $matches)) {
        $payload = require_auth_payload();
        $pdf = $salesService->getPdf((int)($payload['sub'] ?? $payload['id'] ?? 0), (int)$matches[1]);
        header('Content-Type: application/pdf');
        header('Content-Disposition: inline; filename="' . $pdf['filename'] . '"');
        echo $pdf['bytes'];
        exit;
    }

    if ($method === 'GET' && ($path === '/ventas/compartidas/confirmacion' || $path === '/ventas/compartidas/confirmacion-estado')) {
        json_response($salesService->sharedConfirmationState(require_auth_payload(), $_GET));
    }

    if ($method === 'POST' && ($path === '/ventas/compartidas/confirmar' || $path === '/ventas/compartidas/confirmar-reporte')) {
        json_response($salesService->confirmShared(require_auth_payload(), read_json_body()));
    }

    if (str_starts_with($path, '/ventas')) {
        $body = in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true) ? read_json_body() : [];
        $subpath = dispatch_prefixed_route($path, '/ventas');
        json_response($ventasService->route(require_auth_payload(), $method, $subpath, $_GET, $body));
    }

    if (str_starts_with($path, '/notificaciones')) {
        $body = in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true) ? read_json_body() : [];
        $subpath = dispatch_prefixed_route($path, '/notificaciones');
        json_response($notificacionesService->route(require_auth_payload(), $method, $subpath, $_GET, $body));
    }

    if (str_starts_with($path, '/vendedores')) {
        $body = $method === 'PUT' ? read_json_body() : [];
        $subpath = dispatch_prefixed_route($path, '/vendedores');
        $result = $vendedoresService->route(require_auth_payload(), $method, $subpath, $_GET, $body);
        if (($result['stream'] ?? false) === true) {
            header('Content-Type: ' . ($result['contentType'] ?? 'application/octet-stream'));
            header('Content-Disposition: ' . ($result['disposition'] ?? 'inline'));
            echo (string)($result['bytes'] ?? '');
            exit;
        }
        json_response($result);
    }

    if ($method === 'GET' && ($path === '/dashboard/asignados' || $path === '/dashboard/compartidos' || $path === '/dashboard/categorias-vendedor' || $path === '/dashboard/clientes-resumen')) {
        json_response($dashboardService->route(require_auth_payload(), $method, $path, $_GET, []));
    }

    if ($path === '/dashboard/compartir/lista' || $path === '/dashboard/compartir' || preg_match('#^/dashboard/compartir/\d+$#', $path)) {
        $body = in_array($method, ['POST', 'PUT', 'DELETE'], true) ? read_json_body() : [];
        json_response($dashboardService->route(require_auth_payload(), $method, $path, $_GET, $body));
    }



    json_response([
        'ok' => false,
        'error' => sprintf('Ruta no encontrada: %s %s', $method, $path),
    ], 404);
} catch (Throwable $e) {
    $status = (int)$e->getCode();
    if ($status < 400 || $status >= 600) {
        $status = 500;
    }

    error_log('[PHP API] ' . $e->getMessage());
    json_response([
        'ok' => false,
        'error' => $status === 500 ? 'Error interno del servidor' : $e->getMessage(),
    ], $status);
}

