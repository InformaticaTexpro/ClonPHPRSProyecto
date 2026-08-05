<?php
declare(strict_types=1);

return static function (
    string $method,
    string $path,
    array $query,
    array $body,
    array $services
): bool {
    /** @var AuthService $authService */
    $authService = $services['auth'];
    /** @var RecoveryService $recoveryService */
    $recoveryService = $services['recovery'];

    if ($method === 'POST' && $path === '/login') {
        $login = $body['email'] ?? $body['usuario'] ?? null;
        $response = $authService->login((string)$login, (string)($body['password'] ?? ''));
        if (!empty($response['token'])) {
            set_auth_cookie((string)$response['token']);
        }
        json_response($response);
    }

    if ($method === 'GET' && $path === '/me') {
        json_response($authService->me(require_bearer_token()));
    }

    if ($method === 'POST' && $path === '/logout') {
        require_bearer_token();
        clear_auth_cookie();
        json_response(['ok' => true, 'message' => 'Sesion cerrada']);
    }

    if ($method === 'POST' && $path === '/refresh') {
        json_response($authService->refresh(require_bearer_token()));
    }

    if ($method === 'POST' && $path === '/recuperar') {
        json_response($recoveryService->request_reset((string)($body['email'] ?? '')));
    }

    if ($method === 'POST' && $path === '/verificar-otp') {
        json_response($recoveryService->verify_otp((string)($body['email'] ?? ''), (string)($body['otp'] ?? '')));
    }

    if ($method === 'POST' && $path === '/nueva-password') {
        json_response($recoveryService->set_new_password((string)($body['resetToken'] ?? ''), (string)($body['password'] ?? '')));
    }

    return false;
};
