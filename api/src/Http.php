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

function text_looks_corrupted(string $text): bool
{
    return str_contains($text, 'Ã')
        || str_contains($text, 'Â')
        || str_contains($text, 'â')
        || str_contains($text, "\xEF\xBF\xBD");
}

function text_mojibake_score(string $text): int
{
    return substr_count($text, 'Ã')
        + substr_count($text, 'Â')
        + substr_count($text, 'â')
        + substr_count($text, "\xEF\xBF\xBD");
}

function recover_mojibake_once(string $text): string
{
    $candidates = [];

    $converted = @iconv('Windows-1252', 'UTF-8//IGNORE', $text);
    if (is_string($converted) && $converted !== '') {
        $candidates[] = $converted;
    }

    if (function_exists('mb_convert_encoding')) {
        $converted = @mb_convert_encoding($text, 'UTF-8', 'Windows-1252');
        if (is_string($converted) && $converted !== '') {
            $candidates[] = $converted;
        }
    }

    $best = $text;
    $bestScore = text_mojibake_score($text);

    foreach ($candidates as $candidate) {
        $score = text_mojibake_score($candidate);
        if ($score < $bestScore) {
            $best = $candidate;
            $bestScore = $score;
        }
    }

    return $best;
}

function normalize_display_text(mixed $value, string $fallback = ''): string
{
    if ($value === null) {
        return $fallback;
    }

    if (is_bool($value)) {
        $value = $value ? 'true' : 'false';
    } elseif (is_int($value) || is_float($value)) {
        return (string)$value;
    }

    $text = trim((string)$value);
    if ($text === '') {
        return $fallback;
    }

    if (!text_looks_corrupted($text)) {
        return in_array($text, ['-', '–', '—'], true) ? '-' : $text;
    }

    $best = $text;
    $bestScore = text_mojibake_score($text);
    $current = $text;

    for ($i = 0; $i < 3; $i++) {
        $next = recover_mojibake_once($current);
        if ($next === '' || $next === $current) {
            break;
        }

        $score = text_mojibake_score($next);
        if ($score < $bestScore) {
            $best = $next;
            $bestScore = $score;
        }

        $current = $next;
        if ($score === 0) {
            break;
        }
    }

    $best = trim($best);
    if ($best === '') {
        return $fallback;
    }

    return in_array($best, ['-', '–', '—'], true) ? '-' : $best;
}

function normalize_json_payload(mixed $value): mixed
{
    if (is_array($value)) {
        $normalized = [];
        foreach ($value as $key => $item) {
            $normalized[$key] = normalize_json_payload($item);
        }
        return $normalized;
    }

    if (is_string($value)) {
        return normalize_display_text($value);
    }

    return $value;
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
    echo json_encode(
        normalize_json_payload($payload),
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE
    );
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
