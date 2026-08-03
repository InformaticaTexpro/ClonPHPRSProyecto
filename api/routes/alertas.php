<?php
declare(strict_types=1);

return static function (
    string $method,
    string $path,
    array $query,
    array $body,
    array $services
): bool {
    /** @var AlertasService $alertasService */
    $alertasService = $services['alertas'];
    json_response($alertasService->route(require_auth_payload(), $method, $path, $query, $body));
};
