<?php
declare(strict_types=1);

return static function (
    string $method,
    string $path,
    array $query,
    array $body,
    array $services
): bool {
    /** @var AnalyticsService $analyticsService */
    $analyticsService = $services['analytics'];
    if ($method === 'GET' && $path === '/') {
        json_response($analyticsService->cartera(require_auth_payload(), $query));
    }
    return false;
};
