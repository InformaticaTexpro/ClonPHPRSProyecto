<?php
declare(strict_types=1);

return static function (
    string $method,
    string $path,
    array $query,
    array $body,
    array $services
): bool {
    /** @var VendedoresService $vendedoresService */
    $vendedoresService = $services['vendedores'];
    $payload = require_auth_payload();
    $result = $vendedoresService->route($payload, $method, $path, $query, $body);

    if (($result['stream'] ?? false) === true) {
        header('Content-Type: ' . ($result['contentType'] ?? 'application/octet-stream'));
        header('Content-Disposition: ' . ($result['disposition'] ?? 'inline'));
        echo (string)($result['bytes'] ?? '');
        exit;
    }

    json_response($result);
};
