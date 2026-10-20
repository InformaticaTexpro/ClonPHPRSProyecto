<?php
declare(strict_types=1);

return static function (string $method, string $path, array $query, array $body, array $services): bool {
    json_response($services['adquisiciones']->route(require_current_user(), $method, $path, $query));
};
