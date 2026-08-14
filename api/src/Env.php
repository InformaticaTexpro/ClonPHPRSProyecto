<?php
declare(strict_types=1);

function load_env_file(string $path): void
{
    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) {
        return;
    }

    foreach ($lines as $line) {
        $trimmed = trim($line);
        if ($trimmed === '' || str_starts_with($trimmed, '#')) {
            continue;
        }

        $pos = strpos($trimmed, '=');
        if ($pos === false) {
            continue;
        }

        $key = sanitize_env_scalar(substr($trimmed, 0, $pos));
        $value = sanitize_env_scalar(substr($trimmed, $pos + 1));

        if ($value !== '' && (($value[0] === '"' && str_ends_with($value, '"')) || ($value[0] === "'" && str_ends_with($value, "'")))) {
            $value = substr($value, 1, -1);
        }

        $_ENV[$key] = $value;
        putenv($key . '=' . $value);
    }
}

function env(string $key, mixed $default = null): mixed
{
    $value = $_ENV[$key] ?? getenv($key);
    return ($value === false || $value === null || $value === '') ? $default : $value;
}

function sanitize_env_scalar(string $value): string
{
    $value = preg_replace('/^\xEF\xBB\xBF/', '', $value) ?? $value;
    $value = preg_replace('/[\x{00A0}\x{200B}\x{200C}\x{200D}\x{2060}]/u', '', $value) ?? $value;
    $value = preg_replace('/[\r\n\t]+/', '', $value) ?? $value;

    return trim($value);
}
