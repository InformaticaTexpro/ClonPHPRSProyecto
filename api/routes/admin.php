<?php
declare(strict_types=1);

return static function (
    string $method,
    string $path,
    array $query,
    array $body,
    array $services
): bool {
    /** @var AdminService $adminService */
    $adminService = $services['admin'];
    json_response($adminService->route(require_auth_payload(), $method, $path, $query, $body));
};
