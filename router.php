<?php
declare(strict_types=1);

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$path = is_string($path) && $path !== '' ? rawurldecode($path) : '/';

$filePath = __DIR__ . $path;
if ($path !== '/' && is_file($filePath)) {
    return false;
}

if (str_starts_with($path, '/api')) {
    require __DIR__ . '/api/index.php';
    return true;
}

if ($path === '/' || $path === '') {
    header('Location: /src/modulo/varios/login/index.html', true, 302);
    return true;
}

if (is_dir($filePath) && is_file($filePath . DIRECTORY_SEPARATOR . 'index.html')) {
    readfile($filePath . DIRECTORY_SEPARATOR . 'index.html');
    return true;
}

header('Location: /src/modulo/varios/login/index.html', true, 302);
return true;
