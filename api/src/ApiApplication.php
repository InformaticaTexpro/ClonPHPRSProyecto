<?php
declare(strict_types=1);

final class ApiApplication
{
    public function run(): void
    {
        send_cors_headers();

        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
            http_response_code(204);
            return;
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
        $laboratorioService = new LaboratorioService($database);
        $cotizacionesService = new CotizacionesService($database);
        $soporteTiService = new SoporteTiService($database);
        $dashboardService = new DashboardService($database);
        $gerenciaService = new GerenciaService($database);
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
            'laboratorio' => $laboratorioService,
            'cotizaciones' => $cotizacionesService,
            'soporte_ti' => $soporteTiService,
            'dashboard' => $dashboardService,
            'gerencia' => $gerenciaService,
            'ventas' => $ventasService,
            'indicadores' => $indicadoresService,
        ];

        $routes = [
            '/auth' => require dirname(__DIR__) . '/routes/auth.php',
            '/admin' => require dirname(__DIR__) . '/routes/admin.php',
            '/dashboard' => require dirname(__DIR__) . '/routes/dashboard.php',
            '/ventas' => require dirname(__DIR__) . '/routes/ventas.php',
            '/rrhh' => require dirname(__DIR__) . '/routes/rrhh.php',
            '/alertas' => require dirname(__DIR__) . '/routes/alertas.php',
            '/mensajeria' => require dirname(__DIR__) . '/routes/mensajeria.php',
            '/notificaciones' => require dirname(__DIR__) . '/routes/notificaciones.php',
            '/vendedores' => require dirname(__DIR__) . '/routes/vendedores.php',
            '/laboratorio' => require dirname(__DIR__) . '/routes/laboratorio.php',
            '/cotizaciones' => require dirname(__DIR__) . '/routes/cotizaciones.php',
            '/soporte-ti' => require dirname(__DIR__) . '/routes/soporte-ti.php',
            '/indicadores' => require dirname(__DIR__) . '/routes/indicadores.php',
            '/cartera' => require dirname(__DIR__) . '/routes/cartera.php',
            '/gerencia' => require dirname(__DIR__) . '/routes/gerencia.php',
        ];

        $method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        $path = normalize_api_path((string)parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));
        $body = in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true) ? read_json_body() : [];

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
                    $subpath = $this->dispatchPrefixedRoute($path, $prefix);
                    $handled = $handler($method, $subpath, $_GET, $body, $services);
                    if ($handled === true) {
                        return;
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

            $exposeError = in_array(strtolower((string)env('NODE_ENV', 'development')), ['development', 'dev', 'local'], true)
                || strtolower((string)env('APP_DEBUG', 'false')) === 'true';

            json_response([
                'ok' => false,
                'error' => $status >= 500 && !$exposeError ? 'Error interno del servidor' : $e->getMessage(),
            ], $status);
        }
    }

    private function dispatchPrefixedRoute(string $path, string $prefix): string
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
}
