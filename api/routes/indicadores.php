<?php
declare(strict_types=1);

return static function (
    string $method,
    string $path,
    array $query,
    array $body,
    array $services
): bool {
    /** @var IndicadoresService $indicadoresService */
    $indicadoresService = $services['indicadores'];
    if ($method === 'GET' && $path === '/') {
        json_response($indicadoresService->get($query));
    }
    return false;
};
