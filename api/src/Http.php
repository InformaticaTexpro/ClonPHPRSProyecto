<?php
declare(strict_types=1);

function normalize_api_path(string $path): string
{
    $path = preg_replace('#/+#', '/', $path) ?? $path;
    if ($path === '/api') {
        return '/';
    }
    if (str_starts_with($path, '/api/')) {
        return substr($path, 4);
    }
    return $path;
}

function send_cors_headers(): void
{
    $allowed = (string)env('FRONTEND_URL', 'http://localhost:3000');
    header('Access-Control-Allow-Origin: ' . $allowed);
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type,Authorization');
    header('Content-Type: application/json; charset=utf-8');
}

function read_json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }

    $data = json_decode($raw, true);
    if (!is_array($data)) {
        throw new RuntimeException('JSON inválido', 400);
    }

    return $data;
}

function json_response(array $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function get_bearer_token(): ?string
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/^Bearer\s+(.+)$/i', $header, $matches)) {
        return trim($matches[1]);
    }

    $cookieToken = trim((string)($_COOKIE['texpro_token'] ?? ''));
    return $cookieToken !== '' ? $cookieToken : null;
}

function require_bearer_token(): string
{
    $token = get_bearer_token();
    if (!$token) {
        throw new RuntimeException('Token requerido. Incluye Authorization: Bearer <token>', 401);
    }
    return $token;
}

function require_auth_payload(): array
{
    return Security::jwt_decode(require_bearer_token(), (string)env('JWT_SECRET', ''));
}

function set_auth_cookie(string $token): void
{
    $secure = str_starts_with((string)env('FRONTEND_URL', ''), 'https://');
    setcookie('texpro_token', $token, [
        'expires' => 0,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function clear_auth_cookie(): void
{
    $secure = str_starts_with((string)env('FRONTEND_URL', ''), 'https://');
    setcookie('texpro_token', '', [
        'expires' => time() - 3600,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function require_current_user_id(): int
{
    $payload = require_auth_payload();
    $userId = (int)($payload['sub'] ?? $payload['id'] ?? 0);
    if ($userId <= 0) {
        throw new RuntimeException('Token inválido.', 401);
    }
    return $userId;
}
