<?php
declare(strict_types=1);
// Instalación explícita del módulo en la BD LOCAL indicada en .env.
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require_once dirname(__DIR__) . '/api/src/Env.php';
require_once dirname(__DIR__) . '/api/src/Database.php';
load_env_file(dirname(__DIR__) . '/.env');
$host = strtolower(trim((string)env('DB_HOST','')));
if (!in_array($host,['localhost','127.0.0.1'],true) || env('DB_NAME','') !== 'bdtexpro') {
    fwrite(STDERR,"Migración permitida únicamente en bdtexpro LOCAL.\n");
    exit(1);
}
$pdo = (new Database())->mysql();
$hasMain = (bool)$pdo->query("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cliente_solicitud'")->fetchColumn();
$hasHistory = (bool)$pdo->query("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cliente_solicitud_historial'")->fetchColumn();
$hasFicha = (bool)$pdo->query("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cliente_solicitud_ficha'")->fetchColumn();
$snapshot = static function () use ($pdo,$hasMain,$hasHistory,$hasFicha): array {
    $prospectos = $hasMain ? $pdo->query("SELECT id,correlativo,estado,rut_normalizado,creado_en,enviado_en FROM cliente_solicitud WHERE tipo='PROSPECTO' ORDER BY id")->fetchAll(PDO::FETCH_ASSOC) : [];
    $historial = $hasMain && $hasHistory ? $pdo->query("SELECT h.* FROM cliente_solicitud_historial h INNER JOIN cliente_solicitud s ON s.id=h.solicitud_id WHERE s.tipo='PROSPECTO' ORDER BY h.id")->fetchAll(PDO::FETCH_ASSOC) : [];
    $fichas = $hasFicha ? $pdo->query('SELECT solicitud_id,origen_canal,rubro,forma_pago FROM cliente_solicitud_ficha ORDER BY solicitud_id')->fetchAll(PDO::FETCH_ASSOC) : [];
    return ['fichas'=>count($fichas),'snapshot_fichas'=>hash('sha256',serialize($fichas)),'prospectos'=>count($prospectos),'eventos'=>count($historial),'huella'=>hash('sha256',serialize([$prospectos,$historial]))];
};
$before = $snapshot();
$sql = file_get_contents(dirname(__DIR__) . '/database/migrations/crear_solicitudes_clientes_prospectos.sql');
foreach (explode(';',(string)$sql) as $statement) if (trim($statement) !== '') $pdo->exec($statement);
$after = $snapshot();
if ($before !== $after) throw new RuntimeException('La verificación de conservación de Prospectos/Fichas no coincide. Revisar antes de continuar.');
echo 'Fichas conservadas: ' . $after['fichas'] . " (origen, rubro y forma de pago intactos).\n";
echo 'Conservados: ' . $after['prospectos'] . ' Prospectos y ' . $after['eventos'] . " eventos de historial.\n";
foreach ($pdo->query('SELECT tipo,COUNT(*) AS total FROM cliente_solicitud_catalogo GROUP BY tipo ORDER BY tipo') as $catalogo) {
    echo 'Catálogo ' . $catalogo['tipo'] . ': ' . $catalogo['total'] . " valores.\n";
}
echo "Migración aplicada en MySQL LOCAL. No se conectó a Softland ni se enviaron correos.\n";
