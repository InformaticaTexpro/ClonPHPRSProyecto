<?php
declare(strict_types=1);

return static function (
    string $method,
    string $path,
    array $query,
    array $body,
    array $services
): bool {
    /** @var RrhhService $rrhhService */
    $rrhhService = $services['rrhh'];
    $payload = require_auth_payload();
    $result = $rrhhService->route($payload, $method, $path, $query, $body);

    if ($method === 'GET' && preg_match('#^/confirmaciones/(\d+)/pdf$#', $path, $matches)) {
        header('Content-Type: application/pdf');
        header('Content-Disposition: inline; filename="' . $result['filename'] . '"');
        echo $result['bytes'];
        exit;
    }

    json_response($result);
};
