<?php
declare(strict_types=1);

return static function (string $method, string $path, array $query, array $body, array $services): bool {
    if ($path === '/control-clientes/overrides' || str_starts_with($path, '/control-clientes/overrides/')) {
        json_response($services['cobranza_overrides']->route(require_current_user(), $method, $path, $query, $body));
    }
    json_response($services['cobranza']->route(require_current_user(), $method, $path, $query));
};
