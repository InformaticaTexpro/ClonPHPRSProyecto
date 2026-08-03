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

$services = [
    'auth' => $authService,
    'recovery' => $recoveryService,
    'analytics' => $analyticsService,
    'sales' => $salesService,
    'admin' => $adminService,
    'rrhh' => $rrhhService,
    'alertas' => $alertasService,
    'mensajeria' => $mensajeriaService,
    'notificaciones' => $notificacionesService,
    'vendedores' => $vendedoresService,
    'dashboard' => $dashboardService,
    'ventas' => $ventasService,
    'indicadores' => $indicadoresService,
];

$routes = [
    '/auth' => require __DIR__ . '/routes/auth.php',
    '/admin' => require __DIR__ . '/routes/admin.php',
    '/dashboard' => require __DIR__ . '/routes/dashboard.php',
    '/ventas' => require __DIR__ . '/routes/ventas.php',
    '/rrhh' => require __DIR__ . '/routes/rrhh.php',
    '/alertas' => require __DIR__ . '/routes/alertas.php',
    '/mensajeria' => require __DIR__ . '/routes/mensajeria.php',
    '/notificaciones' => require __DIR__ . '/routes/notificaciones.php',
    '/vendedores' => require __DIR__ . '/routes/vendedores.php',
    '/indicadores' => require __DIR__ . '/routes/indicadores.php',
    '/cartera' => require __DIR__ . '/routes/cartera.php',
];

$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$path = normalize_api_path((string)parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));
$body = in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true) ? read_json_body() : [];

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
        } catch (Throwable) {
            json_response([
                'ok' => false,
                'app' => 'RSProyecto',
                'db' => 'disconnected',
                'error' => 'Base de datos no disponible',
            ], 503);
        }
    }

    foreach ($routes as $prefix => $handler) {
        if ($path === $prefix || str_starts_with($path, $prefix . '/')) {
            $subpath = dispatch_prefixed_route($path, $prefix);
            $handled = $handler($method, $subpath, $_GET, $body, $services);
            if ($handled === true) {
                break;
            }
        }
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

    json_response([
        'ok' => false,
        'error' => $status >= 500 ? 'Error interno del servidor' : $e->getMessage(),
    ], $status);
}
