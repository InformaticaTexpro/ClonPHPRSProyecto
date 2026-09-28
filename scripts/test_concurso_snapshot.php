<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/api/bootstrap.php';

$db = new Database();
$pdo = $db->mysql();
$table = 'tmp_concurso_puntaje_mensual';

$pdo->exec("CREATE TEMPORARY TABLE {$table} (
    id int unsigned NOT NULL AUTO_INCREMENT,
    usuario_id int NOT NULL,
    anio smallint unsigned NOT NULL,
    mes tinyint unsigned NOT NULL,
    fecha_cierre date NOT NULL,
    porcentaje_meta decimal(8,2) NOT NULL DEFAULT 0.00,
    puntos_meta int NOT NULL DEFAULT 0,
    clientes_nuevos int NOT NULL DEFAULT 0,
    puntos_nuevos int NOT NULL DEFAULT 0,
    clientes_recuperados int NOT NULL DEFAULT 0,
    puntos_recuperados int NOT NULL DEFAULT 0,
    puntos_total int NOT NULL DEFAULT 0,
    observacion varchar(255) DEFAULT NULL,
    created_at datetime NOT NULL DEFAULT current_timestamp(),
    updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
    PRIMARY KEY (id),
    UNIQUE KEY uq_tmp_concurso_usuario_periodo (usuario_id, anio, mes)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

$upsert = $pdo->prepare(ConcursoVentasService::snapshotUpsertSql($table));
$save = static function (array $row) use ($upsert): void {
    ConcursoVentasService::assertSnapshotConsistent([
        'clientesNuevos' => $row['clientes_nuevos'],
        'puntosNuevos' => $row['puntos_nuevos'],
        'clientesRecuperados' => $row['clientes_recuperados'],
        'puntosRecuperados' => $row['puntos_recuperados'],
        'puntosMeta' => $row['puntos_meta'],
        'puntosTotal' => $row['puntos_total'],
    ]);
    $upsert->execute([
        $row['usuario_id'],
        $row['anio'],
        $row['mes'],
        $row['fecha_cierre'],
        $row['porcentaje_meta'],
        $row['puntos_meta'],
        $row['clientes_nuevos'],
        $row['puntos_nuevos'],
        $row['clientes_recuperados'],
        $row['puntos_recuperados'],
        $row['puntos_total'],
        $row['observacion'] ?? null,
    ]);
};

$save([
    'usuario_id' => 1, 'anio' => 2026, 'mes' => 10, 'fecha_cierre' => '2026-10-31',
    'porcentaje_meta' => 118.23, 'puntos_meta' => 20,
    'clientes_nuevos' => 1, 'puntos_nuevos' => 5,
    'clientes_recuperados' => 4, 'puntos_recuperados' => 12,
    'puntos_total' => 37, 'observacion' => 'caso 1',
]);
$save([
    'usuario_id' => 2, 'anio' => 2026, 'mes' => 10, 'fecha_cierre' => '2026-10-31',
    'porcentaje_meta' => 111.00, 'puntos_meta' => 15,
    'clientes_nuevos' => 0, 'puntos_nuevos' => 0,
    'clientes_recuperados' => 0, 'puntos_recuperados' => 0,
    'puntos_total' => 15, 'observacion' => 'caso 2',
]);
$save([
    'usuario_id' => 1, 'anio' => 2026, 'mes' => 10, 'fecha_cierre' => '2026-10-31',
    'porcentaje_meta' => 118.23, 'puntos_meta' => 20,
    'clientes_nuevos' => 1, 'puntos_nuevos' => 5,
    'clientes_recuperados' => 4, 'puntos_recuperados' => 12,
    'puntos_total' => 37, 'observacion' => 'caso 3 repetido',
]);
$save([
    'usuario_id' => 1, 'anio' => 2026, 'mes' => 11, 'fecha_cierre' => '2026-11-30',
    'porcentaje_meta' => 90.00, 'puntos_meta' => 14,
    'clientes_nuevos' => 0, 'puntos_nuevos' => 0,
    'clientes_recuperados' => 2, 'puntos_recuperados' => 6,
    'puntos_total' => 20, 'observacion' => 'caso 5',
]);

$rows = $pdo->query("SELECT usuario_id, anio, mes, fecha_cierre, porcentaje_meta, puntos_meta,
                            clientes_nuevos, puntos_nuevos, clientes_recuperados,
                            puntos_recuperados, puntos_total
                     FROM {$table}
                     ORDER BY anio, mes, usuario_id")->fetchAll(PDO::FETCH_ASSOC);
$duplicates = $pdo->query("SELECT usuario_id, anio, mes, COUNT(*) AS cantidad
                           FROM {$table}
                           GROUP BY usuario_id, anio, mes
                           HAVING COUNT(*) > 1")->fetchAll(PDO::FETCH_ASSOC);

if (count($rows) !== 3 || $duplicates) {
    fwrite(STDERR, json_encode(['rows' => $rows, 'duplicates' => $duplicates], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    exit(1);
}

echo "OK concurso snapshot: 5 casos validados sin modificar tabla productiva\n";
