<?php
declare(strict_types=1);

return static function (
    string $method,
    string $path,
    array $query,
    array $body,
    array $services
): bool {
    /** @var MensajeriaService $mensajeriaService */
    $mensajeriaService = $services['mensajeria'];
    json_response($mensajeriaService->route(require_auth_payload(), $method, $path, $query, $body));
};
