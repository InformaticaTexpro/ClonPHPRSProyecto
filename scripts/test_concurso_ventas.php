<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/api/src/SharedServiceHelpers.php';
require_once dirname(__DIR__) . '/api/src/ConcursoVentasService.php';

$tests = [
    ['inicio-septiembre', ConcursoVentasService::isActiveForPeriod(2026, 9) ? 1 : 0, 0],
    ['inicio-octubre', ConcursoVentasService::isActiveForPeriod(2026, 10) ? 1 : 0, 1],
    ['visible-agosto', ConcursoVentasService::isVisibleForPeriod(2026, 8) ? 1 : 0, 0],
    ['validacion-septiembre', ConcursoVentasService::isValidationPeriod(2026, 9) ? 1 : 0, 1],
    ['visible-septiembre', ConcursoVentasService::isVisibleForPeriod(2026, 9) ? 1 : 0, 1],
    ['visible-octubre', ConcursoVentasService::isVisibleForPeriod(2026, 10) ? 1 : 0, 1],
    ['visible-noviembre', ConcursoVentasService::isVisibleForPeriod(2026, 11) ? 1 : 0, 1],
    ['pct-69.99', ConcursoVentasService::progressPoints(30000000, 20997000), 0],
    ['pct-70', ConcursoVentasService::progressPoints(30000000, 21000000), 10],
    ['pct-79.99', ConcursoVentasService::progressPoints(30000000, 23997000), 10],
    ['pct-80', ConcursoVentasService::progressPoints(30000000, 24000000), 13],
    ['pct-89.99', ConcursoVentasService::progressPoints(30000000, 26997000), 13],
    ['pct-90', ConcursoVentasService::progressPoints(30000000, 27000000), 14],
    ['pct-100', ConcursoVentasService::progressPoints(30000000, 30000000), 14],
    ['pct-100.01', ConcursoVentasService::progressPoints(30000000, 30003000), 17],
    ['pct-110', ConcursoVentasService::progressPoints(30000000, 33000000), 17],
    ['pct-110.01', ConcursoVentasService::progressPoints(30000000, 33003000), 20],
    ['pct-120', ConcursoVentasService::progressPoints(30000000, 36000000), 20],
    ['pct-120.01', ConcursoVentasService::progressPoints(30000000, 36003000), 23],
    ['meta-10000000', ConcursoVentasService::progressPoints(10000000, 7000000), 2],
    ['meta-10000001', ConcursoVentasService::progressPoints(10000001, 7000000.7), 5],
    ['meta-25000000', ConcursoVentasService::progressPoints(25000000, 17500000), 5],
    ['meta-25000001', ConcursoVentasService::progressPoints(25000001, 17500000.7), 10],
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
    ['G2', ConcursoVentasService::countEligibleGroupedPurchases([
        ['CodAux' => 'X', 'FechaCompra' => '2026-09-05', 'Monto' => 200001],
    ], 200000) * 5, 5],
    ['H', ConcursoVentasService::isRecoveredByDays('2026-02-01', '2026-09-05', 180)
        && ConcursoVentasService::countEligibleGroupedPurchases([
            ['CodAux' => 'R', 'FechaCompra' => '2026-09-05', 'Monto' => 110000],
            ['CodAux' => 'R', 'FechaCompra' => '2026-09-05', 'Monto' => 100000],
        ], 200000) === 1 ? 3 : 0, 3],
    ['I', ConcursoVentasService::isRecoveredByDays('2026-04-08', '2026-09-05', 180) ? 3 : 0, 0],
    ['I2', ConcursoVentasService::isRecoveredByDays('2026-03-09', '2026-09-05', 180) ? 3 : 0, 0],
    ['I3', ConcursoVentasService::isRecoveredByDays('2026-03-08', '2026-09-05', 180) ? 3 : 0, 3],
    ['J', ConcursoVentasService::isRecoveredByDays('2025-08-01', '2026-09-05', 365) ? 3 : 0, 3],
    ['J2', ConcursoVentasService::isRecoveredByDays('2025-09-05', '2026-09-05', 365) ? 3 : 0, 0],
    ['J3', ConcursoVentasService::isRecoveredByDays('2025-09-04', '2026-09-05', 365) ? 3 : 0, 3],
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
