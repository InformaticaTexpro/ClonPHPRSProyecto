<?php
declare(strict_types=1);

return static function (
    string $method,
    string $path,
    array $query,
    array $body,
    array $services
): bool {
    /** @var VentasService $ventasService */
    $ventasService = $services['ventas'];
    /** @var SalesService $salesService */
    $salesService = $services['sales'];

    $payload = require_auth_payload();

    if ($method === 'POST' && $path === '/confirmar') {
        json_response($salesService->confirmar($payload, $body));
    }
    if ($method === 'GET' && preg_match('#^/confirmacion/(\d+)/pdf$#', $path, $matches)) {
        $pdf = $salesService->getPdf((int)($payload['sub'] ?? $payload['id'] ?? 0), (int)$matches[1]);
        header('Content-Type: application/pdf');
        header('Content-Disposition: inline; filename="' . $pdf['filename'] . '"');
        echo $pdf['bytes'];
        exit;
    }
    if ($method === 'GET' && $path === '/compartidas/confirmacion') {
        json_response($salesService->sharedConfirmationState($payload, $query));
    }
    if ($method === 'POST' && $path === '/compartidas/confirmar') {
        json_response($salesService->confirmShared($payload, $body));
    }

    json_response($ventasService->route($payload, $method, $path, $query, $body));
};
