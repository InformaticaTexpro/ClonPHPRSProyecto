<?php
declare(strict_types=1);

return static function (
    string $method,
    string $path,
    array $query,
    array $body,
    array $services
): bool {
    if (str_starts_with($path, '/concurso-promedios/')) {
        require_once dirname(__DIR__) . '/src/ConcursoPromediosService.php';
        $db = new Database();
        $concurso = new ConcursoPromediosService($db, new AnalyticsService($db));
        json_response($concurso->route(require_auth_payload(), $method, $path, $query, $body));
    }
    /** @var AdminService $adminService */
    $adminService = $services['admin'];
    json_response($adminService->route(require_auth_payload(), $method, $path, $query, $body));
};
