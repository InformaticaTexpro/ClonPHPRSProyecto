<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/api/src/SharedServiceHelpers.php';
require_once dirname(__DIR__) . '/api/src/ConcursoVentasService.php';

$tests = [
    ['A', ConcursoVentasService::progressPoints(8000000, 6000000), 2],
    ['B', ConcursoVentasService::progressPoints(20000000, 19000000), 9],
    ['C', ConcursoVentasService::progressPoints(30000000, 34500000), 20],
    ['D', ConcursoVentasService::progressPoints(30000000, 37500000), 23],
    ['E', ConcursoVentasService::progressPoints(30000000, 20700000), 0],
    ['F', ConcursoVentasService::countEligibleGroupedPurchases([
        ['CodAux' => 'X', 'FechaCompra' => '2026-09-05', 'Monto' => 120000],
        ['CodAux' => 'X', 'FechaCompra' => '2026-09-05', 'Monto' => 90000],
    ], 200000) * 5, 5],
    ['G', ConcursoVentasService::countEligibleGroupedPurchases([
        ['CodAux' => 'X', 'FechaCompra' => '2026-09-05', 'Monto' => 200000],
    ], 200000) * 5, 0],
    ['H', ConcursoVentasService::isRecoveredByDays('2026-02-01', '2026-09-05', 180)
        && ConcursoVentasService::countEligibleGroupedPurchases([
            ['CodAux' => 'R', 'FechaCompra' => '2026-09-05', 'Monto' => 110000],
            ['CodAux' => 'R', 'FechaCompra' => '2026-09-05', 'Monto' => 100000],
        ], 200000) === 1 ? 3 : 0, 3],
    ['I', ConcursoVentasService::isRecoveredByDays('2026-04-08', '2026-09-05', 180) ? 3 : 0, 0],
    ['J', ConcursoVentasService::isRecoveredByDays('2025-08-01', '2026-09-05', 365) ? 3 : 0, 3],
    ['K', ConcursoVentasService::isRecoveredByDays(null, '2026-09-05', 180) ? 3 : 0, 0],
    ['L', ConcursoVentasService::countEligibleGroupedPurchases([
        ['CodAux' => 'X', 'FechaCompra' => '2026-09-05', 'Monto' => 120000],
        ['CodAux' => 'X', 'FechaCompra' => '2026-09-05', 'Monto' => 90000],
        ['CodAux' => 'X', 'FechaCompra' => '2026-09-05', 'Monto' => 50000],
    ], 200000), 1],
];

$failed = 0;
foreach ($tests as [$name, $actual, $expected]) {
    if ($actual !== $expected) {
        $failed++;
        fwrite(STDERR, sprintf("FAIL %s: expected %s, got %s\n", $name, (string)$expected, (string)$actual));
    }
}

if ($failed > 0) {
    exit(1);
}

echo "OK concurso ventas: " . count($tests) . " validaciones\n";
