<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/api/bootstrap.php';

$anio = (int)($argv[1] ?? 0);
$mes = (int)($argv[2] ?? 0);
$userId = (int)($argv[3] ?? 0);
$execute = in_array('--execute', $argv, true);

if ($anio <= 0 || $mes < 1 || $mes > 12 || $userId <= 0) {
    fwrite(STDERR, "Uso: php scripts/cierre_concurso_mensual.php <anio> <mes> <usuario_id> [--execute]\n");
    exit(1);
}

$db = new Database();
$muestras = new MuestrasService($db);
$analytics = new AnalyticsService($db, $muestras);
$concurso = new ConcursoVentasService($db, $analytics);
$user = $db->fetchOne('SELECT id, nombre, email, area FROM usuario WHERE id = ? LIMIT 1', [$userId]);
if (!$user) {
    fwrite(STDERR, "Usuario no encontrado.\n");
    exit(1);
}

$result = $concurso->guardarSnapshotMensual(
    ['sub' => $userId, 'area' => (string)($user['area'] ?? '')],
    $anio,
    $mes,
    $execute ? 'Cierre mensual manual' : 'Simulacion de cierre mensual',
    !$execute
);

echo json_encode([
    'modo' => $execute ? 'execute' : 'dry-run',
    'usuario' => [
        'id' => (int)$user['id'],
        'nombre' => $user['nombre'],
        'email' => $user['email'],
    ],
    'resultado' => $result,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), PHP_EOL;
