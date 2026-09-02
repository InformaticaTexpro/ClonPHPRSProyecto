<?php
declare(strict_types=1);

return static function (
    string $method,
    string $path,
    array $query,
    array $body,
    array $services
): bool {
    /** @var CotizacionesService $cotizacionesService */
    $cotizacionesService = $services['cotizaciones'];
    $payload = require_auth_payload();

    json_response($cotizacionesService->route($payload, $method, $path, $query, $body));
};
