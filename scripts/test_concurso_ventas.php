<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/api/src/SharedServiceHelpers.php';
require_once dirname(__DIR__) . '/api/src/ConcursoReglasMeta.php';
require_once dirname(__DIR__) . '/api/src/AnalyticsService.php';
require_once dirname(__DIR__) . '/api/src/ConcursoVentasService.php';

$tests = [
    ['inicio-septiembre', ConcursoVentasService::isActiveForPeriod(2026, 9) ? 1 : 0, 0],
    ['inicio-octubre', ConcursoVentasService::isActiveForPeriod(2026, 10) ? 1 : 0, 1],
    ['visible-septiembre', ConcursoVentasService::isVisibleForPeriod(2026, 9) ? 1 : 0, 0],
    ['visible-octubre', ConcursoVentasService::isVisibleForPeriod(2026, 10) ? 1 : 0, 1],
    ['validacion-septiembre-desactivada', ConcursoVentasService::isValidationPeriod(2026, 9) ? 1 : 0, 0],
    ['A', ConcursoVentasService::progressPoints(8000000, 6000000), 0],
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
    ['meta-69-sin-puntos', ConcursoReglasMeta::evaluate(1000, 690)['puntosMeta'], 0],
    ['meta-70-sin-puntos', ConcursoReglasMeta::evaluate(1000, 700)['puntosMeta'], 0],
    ['meta-75-sin-puntos', ConcursoReglasMeta::evaluate(1000, 750)['puntosMeta'], 0],
    ['meta-79-sin-puntos', ConcursoReglasMeta::evaluate(1000, 790)['puntosMeta'], 0],
    ['meta-80-entra-tramo', ConcursoReglasMeta::evaluate(1000, 800)['puntosMeta'], 4],
    ['round-99-4', ConcursoReglasMeta::evaluate(1000, 994)['cumplimiento'], 99],
    ['round-99-5', ConcursoReglasMeta::evaluate(1000, 995)['cumplimiento'], 100],
    ['round-100-4', ConcursoReglasMeta::evaluate(1000, 1004)['cumplimiento'], 100],
    ['round-100-5', ConcursoReglasMeta::evaluate(1000, 1005)['cumplimiento'], 101],
    ['round-114-4', ConcursoReglasMeta::evaluate(1000, 1144)['cumplimiento'], 114],
    ['round-114-5', ConcursoReglasMeta::evaluate(1000, 1145)['cumplimiento'], 115],
];

$splitTypeCNew = AnalyticsService::splitSharedTypeCClientPoints([
    1 => ['typeC' => true, 'shared' => true, 'weight' => 0.5],
    2 => ['typeC' => true, 'shared' => true, 'weight' => 0.5],
], 5.0);
$splitTypeCRecovered = AnalyticsService::splitSharedTypeCClientPoints([
    1 => ['typeC' => true, 'shared' => true, 'weight' => 0.5],
    2 => ['typeC' => true, 'shared' => true, 'weight' => 0.5],
], 3.0);
$directTypeC = AnalyticsService::splitSharedTypeCClientPoints([
    1 => ['typeC' => true, 'shared' => false, 'weight' => 1.0],
], 5.0);
$otherTypes = AnalyticsService::splitSharedTypeCClientPoints([
    1 => ['typeC' => false, 'shared' => true, 'weight' => 0.5],
    2 => ['typeC' => false, 'shared' => true, 'weight' => 0.5],
], 5.0);
$sharedTypeCWithOther = AnalyticsService::splitSharedTypeCClientPoints([
    23 => ['typeC' => true, 'shared' => true, 'weight' => 0.5],
    99 => ['typeC' => false, 'shared' => true, 'weight' => 0.5],
], 3.0);

$tests = array_merge($tests, [
    ['split-c-nuevo-v1', $splitTypeCNew[1] ?? null, 2.5],
    ['split-c-nuevo-v2', $splitTypeCNew[2] ?? null, 2.5],
    ['split-c-nuevo-total', array_sum($splitTypeCNew), 5.0],
    ['split-c-recuperado-v1', $splitTypeCRecovered[1] ?? null, 1.5],
    ['split-c-recuperado-v2', $splitTypeCRecovered[2] ?? null, 1.5],
    ['split-c-recuperado-total', array_sum($splitTypeCRecovered), 3.0],
    ['split-c-directo', $directTypeC[1] ?? null, 5.0],
    ['split-otros-tipos-sin-cambio-v1', $otherTypes[1] ?? null, 5.0],
    ['split-otros-tipos-sin-cambio-v2', $otherTypes[2] ?? null, 5.0],
    ['split-c-con-vendedor-p-c', $sharedTypeCWithOther[23] ?? null, 1.5],
    ['split-c-con-vendedor-p-p', $sharedTypeCWithOther[99] ?? null, 1.5],
    ['split-c-con-vendedor-p-total', array_sum($sharedTypeCWithOther), 3.0],
]);

$failed = 0;
foreach ($tests as [$name, $actual, $expected]) {
    $matches = is_numeric($actual) && is_numeric($expected)
        ? abs((float)$actual - (float)$expected) <= 0.0001
        : $actual === $expected;
    if (!$matches) {
        $failed++;
        fwrite(STDERR, sprintf("FAIL %s: expected %s, got %s\n", $name, (string)$expected, (string)$actual));
    }
}

if ($failed > 0) {
    exit(1);
}

echo "OK concurso ventas: " . count($tests) . " validaciones\n";
