<?php
declare(strict_types=1);

return static function (
    string $method,
    string $path,
    array $query,
    array $body,
    array $services
): bool {
    /** @var NotificacionesService $notificacionesService */
    $notificacionesService = $services['notificaciones'];
    json_response($notificacionesService->route(require_auth_payload(), $method, $path, $query, $body));
};
