<?php
declare(strict_types=1);

return static function (
    string $method,
    string $path,
    array $query,
    array $body,
    array $services
): bool {
    /** @var LaboratorioService $laboratorioService */
    $laboratorioService = $services['laboratorio'];
    $payload = require_auth_payload();

    if ($method === 'GET' && preg_match('#^/solicitudes/(\d+)/pdf$#', $path, $matches)) {
        throw new RuntimeException('La funcion PDF de laboratorio esta temporalmente deshabilitada.', 410);
    }

    json_response($laboratorioService->route($payload, $method, $path, $query, $body));
};
