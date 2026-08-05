<?php
declare(strict_types=1);

return static function (
    string $method,
    string $path,
    array $query,
    array $body,
    array $services
): bool {
    /** @var AnalyticsService $analyticsService */
    $analyticsService = $services['analytics'];
    /** @var DashboardService $dashboardService */
    $dashboardService = $services['dashboard'];
    $payload = require_auth_payload();

    if ($method === 'GET' && $path === '/resumen') {
        json_response($analyticsService->resumen($payload, $query));
    }
    if ($method === 'GET' && $path === '/evolucion') {
        json_response($analyticsService->evolucion($payload, $query));
    }
    if ($method === 'GET' && $path === '/vendedores') {
        json_response($analyticsService->vendedores($payload, $query));
    }
    if ($method === 'GET' && $path === '/ventas-mes') {
        json_response($analyticsService->ventasMes($payload, $query));
    }
    if ($method === 'GET' && $path === '/vendedores-todos') {
        json_response($analyticsService->vendedoresTodos($payload));
    }
    if ($method === 'GET' && $path === '/compartidos') {
        json_response($analyticsService->compartidos($payload, $query));
    }
    if ($method === 'GET' && $path === '/asignados') {
        json_response($analyticsService->asignados($payload, $query));
    }
    if ($method === 'GET' && $path === '/compartir/lista') {
        json_response($analyticsService->compartirLista($payload, $query));
    }
    if ($method === 'GET' && $path === '/categorias-vendedor') {
        $result = $analyticsService->categoriasVendedor($payload, $query);
        json_response(['ok' => true, 'vendedores' => $result['vendedores'], 'todasLasCategorias' => $result['todasLasCategorias']]);
    }
    if ($method === 'GET' && $path === '/clientes-resumen') {
        json_response(['ok' => true, 'clientes' => $analyticsService->clientesResumen($payload, $query)]);
    }
    if ($method === 'POST' && $path === '/compartir') {
        json_response($dashboardService->route($payload, $method, $path, $query, $body));
    }
    if ($method === 'PUT' && preg_match('#^/compartir/(\d+)$#', $path, $matches)) {
        json_response($dashboardService->route($payload, $method, $path, $query, $body));
    }
    if ($method === 'DELETE' && preg_match('#^/compartir/(\d+)$#', $path, $matches)) {
        json_response($dashboardService->route($payload, $method, $path, $query, $body));
    }

    return false;
};
