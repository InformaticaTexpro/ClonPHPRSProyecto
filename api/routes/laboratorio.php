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
    json_response($laboratorioService->route(require_auth_payload(), $method, $path, $query, $body));
};
