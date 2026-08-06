<?php
declare(strict_types=1);

return static function (
    string $method,
    string $path,
    array $query,
    array $body,
    array $services
): bool {
    /** @var GerenciaService $gerenciaService */
    $gerenciaService = $services['gerencia'];

    json_response($gerenciaService->route(require_auth_payload(), $method, $path, $query, $body));
};
