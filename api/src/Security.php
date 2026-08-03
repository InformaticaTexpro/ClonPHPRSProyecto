<?php
declare(strict_types=1);

final class Security
{
    public static function normalize_login(mixed $value): string
    {
        return mb_strtolower(trim((string)$value));
    }

    public static function parse_django_hash(string $encoded): array
    {
        if ($encoded === '') {
            throw new RuntimeException('Hash inválido: debe ser un string no vacío', 400);
        }

        $parts = explode('$', $encoded);
        if (count($parts) !== 4) {
            throw new RuntimeException('Formato de hash Django inválido', 400);
        }

        [$algorithm, $iterations, $salt, $hash] = $parts;
        if (!is_numeric($iterations) || (int)$iterations <= 0) {
            throw new RuntimeException('Número de iteraciones inválido', 400);
        }

        return [
            'algorithm' => $algorithm,
            'iterations' => (int)$iterations,
            'salt' => $salt,
            'hash' => $hash,
        ];
    }

    public static function verify_password_django(string $password, string $encoded): bool
    {
        try {
            $parsed = self::parse_django_hash($encoded);
        } catch (Throwable) {
            return false;
        }

        if (($parsed['algorithm'] ?? '') !== 'pbkdf2_sha256') {
            return false;
        }

        $derived = hash_pbkdf2(
            'sha256',
            $password,
            (string)$parsed['salt'],
            (int)$parsed['iterations'],
            32,
            true
        );

        $calculated = base64_encode($derived);
        return hash_equals((string)$parsed['hash'], $calculated);
    }

    public static function hash_password_django(string $password): string
    {
        $salt = rtrim(strtr(base64_encode(random_bytes(12)), '+/', '-_'), '=');
        $iterations = 600000;
        $derived = hash_pbkdf2('sha256', $password, $salt, $iterations, 32, true);
        return sprintf('pbkdf2_sha256$%d$%s$%s', $iterations, $salt, base64_encode($derived));
    }

    public static function validate_folio(mixed $value): int
    {
        $text = trim((string)$value);
        if (!preg_match('/^\d+$/', $text)) {
            throw new RuntimeException(sprintf('Folio inválido: "%s". Debe ser un entero positivo.', (string)$value), 400);
        }

        $num = (int)$text;
        if ($num <= 0 || $num > 9999999) {
            throw new RuntimeException(sprintf('Folio inválido: "%s". Debe ser un entero positivo.', (string)$value), 400);
        }

        return $num;
    }

    public static function validate_cod_vendedor(mixed $value): string
    {
        $text = trim((string)$value);
        if (!preg_match('/^[A-Za-z0-9-]{1,20}$/', $text)) {
            throw new RuntimeException(sprintf('Código de vendedor inválido: "%s".', $text), 400);
        }

        return $text;
    }

    public static function validate_porcentaje(mixed $value): int
    {
        $num = (float)$value;
        if (!is_finite($num) || $num < 1 || $num > 100) {
            throw new RuntimeException(sprintf('Porcentaje inválido: "%s". Debe estar entre 1 y 100.', (string)$value), 400);
        }
        return (int)round($num);
    }

    public static function validate_id(mixed $value): int
    {
        $text = trim((string)$value);
        if (!preg_match('/^\d+$/', $text)) {
            throw new RuntimeException(sprintf('ID inválido: "%s". Debe ser un entero positivo.', (string)$value), 400);
        }
        $num = (int)$text;
        if ($num <= 0) {
            throw new RuntimeException(sprintf('ID inválido: "%s". Debe ser un entero positivo.', (string)$value), 400);
        }
        return $num;
    }

    public static function validate_email(mixed $value): string
    {
        $email = mb_strtolower(trim((string)$value));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new RuntimeException(sprintf('Email inválido: "%s"', $email), 400);
        }
        return $email;
    }

    public static function validate_rut(mixed $value): string
    {
        $rut = strtoupper(trim((string)$value));
        if (!preg_match('/^\d{1,2}\.?\d{3}\.?\d{3}-?[0-9K]$/', $rut)) {
            throw new RuntimeException('RUT inválido.', 400);
        }
        return $rut;
    }

    public static function validate_mes_anio(mixed $mesValue, mixed $anioValue): array
    {
        $now = new DateTimeImmutable('now');
        $mes = $mesValue === null || $mesValue === '' ? (int)$now->format('n') : (int)$mesValue;
        $anio = $anioValue === null || $anioValue === '' ? (int)$now->format('Y') : (int)$anioValue;

        if ($mes < 1 || $mes > 12) {
            throw new RuntimeException('Mes inválido. Debe estar entre 1 y 12.', 400);
        }
        if ($anio < 2026 || $anio > 2100) {
            throw new RuntimeException('Año inválido. Debe estar entre 2026 y 2100.', 400);
        }

        return ['mes' => $mes, 'anio' => $anio];
    }

    public static function jwt_encode(array $payload, string $secret, mixed $expiresIn = '8h'): string
    {
        if ($secret === '') {
            throw new RuntimeException('JWT_SECRET no está definido en .env', 500);
        }

        $issuedAt = time();
        $ttl = self::duration_to_seconds($expiresIn);

        $payload = array_merge($payload, [
            'iat' => $issuedAt,
            'exp' => $issuedAt + $ttl,
        ]);

        $header = ['alg' => 'HS256', 'typ' => 'JWT'];
        $segments = [
            self::b64url_encode(json_encode($header, JSON_UNESCAPED_SLASHES)),
            self::b64url_encode(json_encode($payload, JSON_UNESCAPED_SLASHES)),
        ];
        $signingInput = implode('.', $segments);
        $signature = hash_hmac('sha256', $signingInput, $secret, true);
        $segments[] = self::b64url_encode($signature);
        return implode('.', $segments);
    }

    public static function jwt_decode(string $token, string $secret, bool $ignoreExpiration = false): array
    {
        if ($secret === '') {
            throw new RuntimeException('JWT_SECRET no está definido en .env', 500);
        }

        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            throw new RuntimeException('Token inválido.', 401);
        }

        [$head, $body, $sig] = $parts;
        $signingInput = $head . '.' . $body;
        $expected = self::b64url_encode(hash_hmac('sha256', $signingInput, $secret, true));
        if (!hash_equals($expected, $sig)) {
            throw new RuntimeException('Token inválido.', 401);
        }

        $payload = json_decode(self::b64url_decode($body), true);
        if (!is_array($payload)) {
            throw new RuntimeException('Token inválido.', 401);
        }

        if (!$ignoreExpiration && isset($payload['exp']) && time() >= (int)$payload['exp']) {
            throw new RuntimeException('Token expirado. Vuelve a iniciar sesión.', 401);
        }

        return $payload;
    }

    private static function b64url_encode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private static function b64url_decode(string $value): string
    {
        $remainder = strlen($value) % 4;
        if ($remainder > 0) {
            $value .= str_repeat('=', 4 - $remainder);
        }
        return (string)base64_decode(strtr($value, '-_', '+/'), true);
    }

    private static function duration_to_seconds(mixed $duration): int
    {
        if (is_int($duration)) {
            return max(1, $duration);
        }
        $text = trim((string)$duration);
        if ($text === '') {
            return 8 * 3600;
        }
        if (preg_match('/^(\d+)([smhd])$/i', $text, $m)) {
            $value = (int)$m[1];
            $unit = strtolower($m[2]);
            return match ($unit) {
                's' => max(1, $value),
                'm' => max(1, $value * 60),
                'h' => max(1, $value * 3600),
                'd' => max(1, $value * 86400),
                default => 8 * 3600,
            };
        }
        if (ctype_digit($text)) {
            return max(1, (int)$text);
        }
        return 8 * 3600;
    }
}
