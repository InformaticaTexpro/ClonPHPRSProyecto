<?php
declare(strict_types=1);

return static function (
    string $method,
    string $path,
    array $query,
    array $body,
    array $services
): bool {
    /** @var SoporteTiService $soporteTiService */
    $soporteTiService = $services['soporte_ti'];
    $payload = require_auth_payload();

    json_response($soporteTiService->route($payload, $method, $path, $query, $body));
};
