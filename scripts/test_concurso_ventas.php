<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/api/src/SharedServiceHelpers.php';
require_once dirname(__DIR__) . '/api/src/Security.php';
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

// Dobles locales: concursoClientes() completo, sin conexiones ni escrituras.
class ConcursoClientStatement extends PDOStatement
{
    public function __construct(private array $rows, private string $query, private ConcursoClientPDO $owner) {}
    public function execute(?array $params = null): bool
    {
        if (substr_count($this->query, '?') !== count($params ?? [])) throw new RuntimeException('Parametros SQL desalineados');
        $this->owner->executions[] = [$this->query, $params];
        return true;
    }
    public function fetchAll(int $mode = PDO::FETCH_DEFAULT, mixed ...$args): array { return $this->rows; }
    public function fetch(int $mode = PDO::FETCH_DEFAULT, int $cursorOrientation = PDO::FETCH_ORI_NEXT, int $cursorOffset = 0): mixed
    {
        return array_shift($this->rows) ?? false;
    }
}

class ConcursoClientPDO extends PDO
{
    public array $queries = [];
    public array $executions = [];
    public function __construct(private array $batches) {}
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $this->queries[] = $query;
        return new ConcursoClientStatement(array_shift($this->batches), $query, $this);
    }
}

class Database
{
    public function __construct(private PDO $connection, private array $shares) {}
    public function softland(): PDO { return $this->connection; }
    public function fetchAll(string $sql, array $params = []): array
    {
        return str_contains($sql, 'usuario_vendedor') ? [['cod_vendedor' => '479', 'tipo' => 'P']] : $this->shares;
    }
    public function fetchOne(string $sql, array $params = []): array { return ['nombre' => 'Olga']; }
    public function softlandAvailable(): bool { return true; }
}

foreach ([
    ['carol-compartida', 241536, true, 'C', true, 120768, 1.5, false],
    ['compartida-bajo-minimo', 199999, true, 'C', false, 99999.5, 0, false],
    ['directa-califica', 241536, false, 'P', true, 241536, 3, false],
    ['directa-bajo-minimo', 199999, false, 'P', false, 199999, 0, false],
    ['directa-c-conserva-atribucion', 241536, false, 'C', false, 120768, 0, false],
    ['documento-no-duplicado-para-minimo', 110000, true, 'C', false, 110000, 0, true],
] as [$case, $original, $sharedSale, $type, $qualifies, $attributed, $points, $duplicate]) {
    $relations = [
        ['usuarioId' => 1, 'codigoAsociado' => '479', 'tipo' => $type],
        ['usuarioId' => 2, 'codigoAsociado' => '652', 'tipo' => 'C'],
    ];
    $doc = ['clienteCodigo' => '9544139', 'codigoVendedor' => '479', 'NroInt' => 123,
        'tipo' => 'F', 'folio' => 456, 'fecha' => '2026-10-13', 'original' => $original];
    $shares = $sharedSale ? [['folio' => 456, 'fecha' => '2026-10-13',
        'porcentaje' => 50, 'origen' => '479', 'destino' => '652']] : [];
    $totalPoints = 0.0;
    foreach ($sharedSale ? [1, 2] : [1] as $user) {
        $pdo = new ConcursoClientPDO([
            [['clienteCodigo' => '9544139', 'cliente' => 'CAROL DEL PILAR ANDONIE ATALA',
                'primera' => '2024-10-02', 'ultimaPrevia' => '2024-10-02']],
            [['CodAux' => '9544139', 'Identidad' => 'RUT:141560646', 'FechaPrimeraRut' => '2024-10-02',
                'CodAuxPrimero' => '9544139', 'Vendedor' => '479', 'NroInt' => 10, 'Folio' => 10]],
            [],
            $duplicate ? [$doc, $doc] : [$doc],
        ]);
        $result = (new AnalyticsService(new Database($pdo, $shares)))->concursoClientes($relations, 10, $user);
        $row = $result['clientes'][0];
        $tests[] = ["$case-$user-venta-atribuida", $row['ventaMes'], $attributed];
        $tests[] = ["$case-$user-recuperado", $row['categoria'], 'recuperados'];
        $tests[] = ["$case-$user-califica", $row['califica'], $qualifies];
        $tests[] = ["$case-$user-puntos", $row['puntos'], $points];
        $tests[] = ["$case-$user-motivo", $row['motivo'], $qualifies ? '' : 'VENTA < $200.000'];
        $tests[] = ["$case-$user-calificadora-interna", array_key_exists('ventaCalificadora', $row), false];
        $tests[] = ["$case-$user-resumen", $result['resumen'][$user]['puntosRecuperados'], $points];
        $totalPoints += $row['puntos'];
    }
    $tests[] = ["$case-total-puntos", $totalPoints, $sharedSale ? $points * 2 : $points];
}

$rutRelations = [
    ['usuarioId' => 1, 'codigoAsociado' => '479', 'tipo' => 'P'],
    ['usuarioId' => 2, 'codigoAsociado' => '652', 'tipo' => 'P'],
];
foreach ([
    ['rut-dos-codaux', '2026-10-05', '479', false, null, false, 1, 5, 260000],
    ['rut-historia-otro-codaux-vendedor', '2024-01-01', '652', false, null, false, 0, 0, 0],
    ['rut-primer-vendedor', '2026-10-05', '479', false, null, true, 1, 5, 241536],
    ['rut-vacio-codaux-independientes', '2026-10-05', '479', true, null, false, 2, 10, 483072],
    ['rut-recuperado-por-codaux', '2024-01-01', '479', false, '2026-03-01', false, 0, 0, 0],
] as [$case, $firstDate, $firstVendor, $emptyRut, $lastB, $differentVendors, $newCount, $newPoints, $newSale]) {
    $clients = $history = $docs = $assignments = [];
    foreach (['A', 'B'] as $index => $code) {
        $date = $index === 0 ? '2026-10-05' : '2026-10-20';
        $clients[] = ['clienteCodigo' => $code, 'cliente' => $code,
            'primera' => $lastB ? '2024-01-01' : $date,
            'ultimaPrevia' => $lastB ? ($index === 0 ? '2026-09-30' : $lastB) : null];
        $history[] = ['CodAux' => $code, 'Identidad' => $emptyRut ? "CODAUX:$code" : 'RUT:141560646',
            'FechaPrimeraRut' => $emptyRut ? $date : $firstDate, 'CodAuxPrimero' => $emptyRut ? $code : 'A',
            'Vendedor' => $firstVendor, 'NroInt' => $emptyRut ? $index + 1 : 1, 'Folio' => $emptyRut ? $index + 1 : 1];
        $docs[] = ['clienteCodigo' => $code, 'codigoVendedor' => $differentVendors && $index === 1 ? '652' : '479',
            'NroInt' => $index + 1, 'tipo' => 'F', 'folio' => $index + 1, 'fecha' => $date,
            'original' => $case === 'rut-dos-codaux' ? ($index === 0 ? 120000 : 140000) : 241536];
        foreach (['479', '652'] as $vendor) $assignments[] = ['clienteCodigo' => $code, 'vendedor' => $vendor];
    }
    foreach ([1, 2] as $user) {
        $batches = [$clients, $history, $assignments, $docs];
        if (!$emptyRut) array_unshift($batches, [['Identidad' => 'RUT:141560646']], [['CodAux' => 'A'], ['CodAux' => 'B']]);
        $pdo = new ConcursoClientPDO($batches);
        $result = (new AnalyticsService(new Database($pdo, [])))->concursoClientes($rutRelations, 10, $user, $emptyRut ? null : 'B', true);
        $summary = $result['resumen'][$user];
        $tests[] = ["$case-$user-cantidad", $summary['clientesNuevos'], $user === 1 ? $newCount : 0];
        $tests[] = ["$case-$user-puntos", $summary['puntosNuevos'], $user === 1 ? $newPoints : 0];
        $newRows = array_filter($result['clientes'], static fn(array $row): bool => $row['categoria'] === 'nuevos');
        $tests[] = ["$case-$user-venta-consolidada", array_sum(array_column($newRows, 'ventaMes')), $user === 1 ? $newSale : 0];
        $tests[] = ["$case-$user-recuperados", $summary['clientesRecuperados'], $lastB && $user === 1 ? 1 : 0];
        if ($lastB && $user === 1) {
            $tests[] = ["$case-codaux-recuperado", $result['clientes'][0]['clienteCodigo'], 'B'];
            $tests[] = ["$case-puntos-recuperado", $summary['puntosRecuperados'], 3];
        }
        if ($case === 'rut-primer-vendedor' && $user === 1) {
            $tests[] = ['rut-detalle-representante-primera-compra', array_values($newRows)[0]['clienteCodigo'], 'A'];
        }
    }
}

// Nuevo compartido: conserva venta atribuida, minimo original y reparto existente.
foreach ([1, 2] as $user) {
    $doc = ['clienteCodigo' => 'A', 'codigoVendedor' => '479', 'NroInt' => 1,
        'tipo' => 'F', 'folio' => 1, 'fecha' => '2026-10-05', 'original' => 241536];
    $pdo = new ConcursoClientPDO([
        [['clienteCodigo' => 'A', 'cliente' => 'A', 'primera' => '2026-10-05', 'ultimaPrevia' => null]],
        [['CodAux' => 'A', 'Identidad' => 'RUT:76123456K', 'FechaPrimeraRut' => '2026-10-05',
            'CodAuxPrimero' => 'A', 'Vendedor' => '479', 'NroInt' => 1, 'Folio' => 1]],
        [['clienteCodigo' => 'A', 'vendedor' => '479'], ['clienteCodigo' => 'A', 'vendedor' => '652']],
        [$doc],
    ]);
    $relations = array_map(static fn(array $row): array => array_replace($row, ['tipo' => 'C']), $rutRelations);
    $shares = [['folio' => 1, 'fecha' => '2026-10-05', 'porcentaje' => 50, 'origen' => '479', 'destino' => '652']];
    $result = (new AnalyticsService(new Database($pdo, $shares)))->concursoClientes($relations, 10, $user);
    $tests[] = ["rut-nuevo-compartido-$user-venta", $result['clientes'][0]['ventaMes'], 120768];
    $tests[] = ["rut-nuevo-compartido-$user-califica", $result['clientes'][0]['califica'], true];
    $tests[] = ["rut-nuevo-compartido-$user-puntos", $result['clientes'][0]['puntos'], 2.5];
    $tests[] = ["rut-nuevo-compartido-total", array_sum(array_column($result['resumen'], 'puntosNuevos')), 5];
}

// Primera factura compartida sin asignar artificialmente ambos vendedores en cwtauxven.
// El tercero tiene propiedad comercial, pero ninguna participación en la primera factura.
foreach ([
    ['primera-compartida-origen-propietario', 470914, 50, 'C', ['630', '777']],
    ['primera-compartida-receptor-propietario', 470914, 50, 'C', ['454', '777']],
    ['primera-compartida-solo-factura', 470914, 50, 'C', ['777']],
    ['primera-compartida-pesos-distintos', 470914, 60, 'C', ['630', '777']],
    ['primera-compartida-bajo-minimo', 199999, 50, 'C', ['630', '777']],
    ['primera-directa-con-propietario', 300000, null, 'P', ['630', '777']],
    ['primera-directa-sin-propietario', 300000, null, 'P', ['777']],
] as [$case, $original, $percentage, $originType, $assignedCodes]) {
    $relations = [
        ['usuarioId' => 1, 'codigoAsociado' => '630', 'tipo' => $originType],
        ['usuarioId' => 2, 'codigoAsociado' => '454', 'tipo' => 'P'],
        ['usuarioId' => 3, 'codigoAsociado' => '777', 'tipo' => 'P'],
    ];
    $doc = ['clienteCodigo' => 'AR', 'codigoVendedor' => '630', 'NroInt' => 381156,
        'tipo' => 'F', 'folio' => 381156, 'fecha' => '2026-10-05', 'original' => $original];
    $shares = $percentage === null ? [] : [['folio' => 381156, 'fecha' => '2026-10-05',
        'porcentaje' => $percentage, 'origen' => '630', 'destino' => '454']];
    $expectedUsers = $percentage !== null ? [1, 2] : (in_array('630', $assignedCodes, true) ? [1] : []);
    $qualifies = $original >= 200000;
    $originFactor = $originType === 'C' ? .5 : 1.0;
    $weights = $percentage === null ? $originFactor : $originFactor + $percentage / 100;
    foreach ([null, 1, 2, 3] as $user) {
        $pdo = new ConcursoClientPDO([
            [['clienteCodigo' => 'AR', 'cliente' => 'A & R SPA', 'primera' => '2026-10-05', 'ultimaPrevia' => null]],
            [['CodAux' => 'AR', 'Identidad' => 'RUT:76123456K', 'FechaPrimeraRut' => '2026-10-05',
                'CodAuxPrimero' => 'AR', 'Vendedor' => '630', 'NroInt' => 381156, 'Folio' => 381156]],
            array_map(static fn(string $code): array => ['clienteCodigo' => 'AR', 'vendedor' => $code], $assignedCodes),
            [$doc],
        ]);
        $result = (new AnalyticsService(new Database($pdo, $shares)))->concursoClientes($relations, 10, $user, null, true, $user === null);
        $rows = array_values(array_filter($result['clientes'], static fn(array $row): bool => $row['categoria'] === 'nuevos'));
        $visible = $user === null ? $expectedUsers : array_values(array_intersect($expectedUsers, [$user]));
        $scope = $user ?? 'todos';
        $tests[] = ["$case-$scope-participantes", implode(',', array_column($rows, 'usuarioId')), implode(',', $visible)];
        $tests[] = ["$case-$scope-tercero-sin-puntos", $result['resumen'][3]['puntosNuevos'], 0];
        $tests[] = ["$case-$scope-total-puntos", array_sum(array_column($result['resumen'], 'puntosNuevos')), $qualifies && $expectedUsers ? 5 : 0];
        foreach ($visible as $id) {
            $row = array_values(array_filter($rows, static fn(array $r): bool => $r['usuarioId'] === $id))[0] ?? [];
            $factor = $id === 1 ? $originFactor : $percentage / 100;
            $points = $qualifies ? 5 * $factor / $weights : 0;
            $tests[] = ["$case-$scope-$id-venta", $row['ventaMes'] ?? -1, $original * $factor];
            $tests[] = ["$case-$scope-$id-califica", $row['califica'] ?? null, $qualifies];
            $tests[] = ["$case-$scope-$id-puntos", $row['puntos'] ?? -1, $points];
            if ($user !== null) {
                $folio = $row['folios'][0] ?? [];
                $tests[] = ["$case-$scope-$id-original", $folio['original'] ?? -1, $original];
                $tests[] = ["$case-$scope-$id-porcentaje", $folio['porcentaje'] ?? -1, $factor * 100];
                $tests[] = ["$case-$scope-$id-atribuida", $folio['atribuida'] ?? -1, $original * $factor];
            }
        }
    }
}

// Detalle acotado a un RUT: propios + compartidas recibidas; ajenos y atribucion cero fuera.
foreach ([false, true] as $sharedOrigin) {
    $relations = [
        ['usuarioId' => 1, 'codigoAsociado' => '479', 'tipo' => 'P'],
        ['usuarioId' => 2, 'codigoAsociado' => '652', 'tipo' => 'P'],
        ['usuarioId' => 3, 'codigoAsociado' => '777', 'tipo' => 'P'],
        ['usuarioId' => 4, 'codigoAsociado' => '888', 'tipo' => 'P'],
    ];
    $clients = [['clienteCodigo' => 'A', 'cliente' => 'Cliente', 'primera' => '2026-10-05', 'ultimaPrevia' => null],
        ['clienteCodigo' => 'B', 'cliente' => 'Sucursal', 'primera' => '2026-10-06', 'ultimaPrevia' => null]];
    $docs = [];
    foreach ([[100, 'A', '479', 220000], [200, 'B', '652', 500000], [300, 'B', '777', 300000],
        [400, 'B', '888', 600000], [500, 'A', '479', 100000], [600, 'A', '479', 0]] as [$folio, $code, $vendor, $original]) {
        $docs[] = ['clienteCodigo' => $code, 'codigoVendedor' => $vendor, 'NroInt' => $folio,
            'tipo' => 'F', 'folio' => $folio, 'fecha' => '2026-10-05', 'original' => $original];
    }
    $pdo = new ConcursoClientPDO([
        [['Identidad' => 'RUT:141560646']], [['CodAux' => 'A'], ['CodAux' => 'B']], $clients,
        [['CodAuxPrimero' => 'A', 'FechaPrimeraRut' => '2026-10-05', 'Vendedor' => '479', 'NroInt' => 100, 'Folio' => 100]],
        [['clienteCodigo' => 'A', 'vendedor' => '479'], ['clienteCodigo' => 'A', 'vendedor' => '652']], $docs,
    ]);
    $shares = [['folio' => 300, 'fecha' => '2026-10-05', 'porcentaje' => 50, 'origen' => '777', 'destino' => '479'],
        ['folio' => 500, 'fecha' => '2026-10-05', 'porcentaje' => 100, 'origen' => '479', 'destino' => '652']];
    if ($sharedOrigin) $shares[] = ['folio' => 100, 'fecha' => '2026-10-05', 'porcentaje' => 50, 'origen' => '479', 'destino' => '652'];
    $result = (new AnalyticsService(new Database($pdo, $shares)))->concursoClientes($relations, 10, 1, 'B');
    $row = $result['clientes'][0];
    $prefix = $sharedOrigin ? 'detalle-origen' : 'detalle-directo';
    $tests[] = ["$prefix-un-evento-rut", $result['resumen'][1]['clientesNuevos'], 1];
    $tests[] = ["$prefix-folios-atribuibles", array_column($row['folios'], 'folio'), [100, 300]];
    $tests[] = ["$prefix-venta-mes", $row['ventaMes'], $sharedOrigin ? 260000 : 370000];
    $tests[] = ["$prefix-total-folios", array_sum(array_column($row['folios'], 'atribuida')), $row['ventaMes']];
    $tests[] = ["$prefix-porcentaje-origen", $row['folios'][0]['porcentaje'], $sharedOrigin ? 50 : 100];
    $tests[] = ["$prefix-recibida-porcentaje", $row['folios'][1]['porcentaje'], 50];
    $tests[] = ["$prefix-recibida-monto", $row['folios'][1]['atribuida'], 150000];
    $tests[] = ["$prefix-recibida-etiqueta", str_contains(implode(' ', $row['folios'][1]['atribucion']), 'RECIBIDA'), true];
    $tests[] = ["$prefix-json-valido", json_decode(json_encode($result, JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR)['clientes'][0]['clienteCodigo'], 'A'];
    $tests[] = ["$prefix-consultas-por-lote", count($pdo->executions), 6];
    foreach ($pdo->executions as [$query, $params]) if (str_contains($query, 'iw_gsaen')) {
        $tests[] = ["$prefix-sin-exists-rut-en-historial", str_contains($query, 'EXISTS') || str_contains($query, 'RutAux'), false];
        $tests[] = ["$prefix-codaux-acotados", in_array('A', $params, true) && in_array('B', $params, true), true];
    }
}

$pdo = new ConcursoClientPDO([
    [['Identidad' => 'CODAUX:100']],
    [['clienteCodigo' => '100', 'cliente' => 'Sin RUT', 'primera' => '2026-10-05', 'ultimaPrevia' => null]],
    [['CodAuxPrimero' => '100', 'FechaPrimeraRut' => '2026-10-05', 'Vendedor' => '479', 'NroInt' => 1, 'Folio' => 1]],
    [['clienteCodigo' => '100', 'vendedor' => '479']],
    [['clienteCodigo' => '100', 'codigoVendedor' => '479', 'NroInt' => 1, 'tipo' => 'F', 'folio' => 1, 'fecha' => '2026-10-05', 'original' => 241536]],
]);
$result = (new AnalyticsService(new Database($pdo, [])))->concursoClientes($rutRelations, 10, 1, '100');
$tests[] = ['detalle-rut-vacio-codaux', $result['clientes'][0]['clienteCodigo'], '100'];
$tests[] = ['detalle-rut-vacio-sin-buscar-otros-codaux', count($pdo->executions), 5];
$tests[] = ['detalle-rut-vacio-total-folios', array_sum(array_column($result['clientes'][0]['folios'], 'atribuida')), 241536];

$portfolioRows = [];
foreach (['A', 'B'] as $code) {
    $portfolioRows[] = ['CodAux' => $code, 'FechaPrimera' => '2026-10-05', 'FechaUltima' => '2026-10-05',
        'FechaMinMesActual' => '2026-10-05', 'FechaUltimaPrevia' => null, 'EsActivo' => 1, 'TieneMesActual' => 1];
}
$pdo = new ConcursoClientPDO([[['CodAux' => 'A'], ['CodAux' => 'B']], $portfolioRows, []]);
$analytics = new AnalyticsService(new Database($pdo, []));
$portfolio = (new ReflectionMethod(AnalyticsService::class, 'carteraOptimizada'))->invoke(
    $analytics, ['sub' => 1, 'area' => 'PRODUCTOS_QUIMICOS'], ['anio' => 2026, 'mes' => 10]);
$tests[] = ['cartera-codaux-dos-nuevos', $portfolio['ClientesNuevos'], 2];
$tests[] = ['cartera-total-clientes-codaux', $portfolio['TotalClientes'], 2];
$tests[] = ['cartera-activos-codaux', $portfolio['ClientesActivos'], 2];

$pdo = new ConcursoClientPDO([[['CodAux' => '78103135']], [[
    'CodAux' => '78103135', 'FechaPrimera' => '2026-10-13', 'FechaUltima' => '2026-10-13',
    'FechaMinMesActual' => '2026-10-13', 'FechaUltimaPrevia' => null, 'EsActivo' => 0,
    'TieneMesActual' => 0, 'FechaUltimaVendedor' => null,
]], []]);
$portfolio = (new ReflectionMethod(AnalyticsService::class, 'carteraOptimizada'))->invoke(
    new AnalyticsService(new Database($pdo, [])), ['sub' => 91, 'area' => 'PRODUCTOS_QUIMICOS'], ['anio' => 2026, 'mes' => 10]);
$tests[] = ['cartera-nuevo-asignado-aunque-facture-otro-vendedor', $portfolio['nuevos'][0]['CodAux'], '78103135'];
$tests[] = ['cartera-nuevo-no-reactiva-con-venta-ajena', $portfolio['ClientesActivos'], 0];
$tests[] = ['cartera-nuevo-inactivo-para-propietario', $portfolio['ClientesInactivos'], 1];
$tests[] = ['cartera-nuevo-no-activo-mes-con-venta-ajena', $portfolio['ClientesActivosMesActual'], 0];

// Ejecuta el CTE real con datos en memoria; adapta solo sintaxis de SQL Server a SQLite.
if (in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    $memory = new PDO('sqlite::memory:');
    $memory->exec('CREATE TABLE cwtauxi (CodAux TEXT, RutAux TEXT)');
    $memory->exec('CREATE TABLE iw_gsaen (CodAux TEXT, CodVendedor TEXT, Fecha TEXT, NroInt INTEGER, Folio INTEGER, Tipo TEXT, Estado TEXT)');
    $insertClient = $memory->prepare('INSERT INTO cwtauxi VALUES (?, ?)');
    foreach ([['A', '14.156.064-6'], ['B', ' 14156064 - 6 '], ['C', '22.222.222-2'],
        ['D', '222222222'], ['100', null], ['200', ' '], ['K', '76.123.456-k'], ['L', '76123456K']] as $row) $insertClient->execute($row);
    $insertDoc = $memory->prepare('INSERT INTO iw_gsaen VALUES (?, ?, ?, ?, ?, ?, ?)');
    foreach ([
        ['A', 'otro-vendedor', '2024-01-01', 1, 1, 'F', 'V'],
        ['B', '479', '2026-10-05', 2, 2, 'F', 'V'],
        ['C', '479', '2026-10-05', 3, 3, 'F', 'V'],
        ['D', '652', '2026-10-20', 4, 4, 'F', 'V'],
        ['100', '479', '2026-10-05', 5, 5, 'F', 'V'],
        ['200', '479', '2026-10-05', 6, 6, 'F', 'V'],
        ['K', '652', '2026-10-05', 8, 1, 'F', 'V'],
        ['L', '479', '2026-10-05', 7, 2, 'F', 'V'],
        ['L', '652', '2024-01-01', 9, 3, 'F', 'A'],
    ] as $row) $insertDoc->execute($row);
    $ctes = AnalyticsService::newClientHistoryCtes("SELECT CodAux FROM cwtauxi WHERE CodAux IN ('B','D','100','200','K','L')");
    $ctes = str_replace(['[PRODIN].[softland].', 'CONVERT(varchar(80), a.RutAux)', ' + '],
        ['', 'CAST(a.RutAux AS TEXT)', ' || '], $ctes);
    $rows = $memory->query("WITH $ctes SELECT ca.CodAux, ca.Identidad, p.CodAux AS Primero, p.Fecha, p.Vendedor
        FROM IdentidadesActuales ca JOIN PrimerasComprasRut p ON p.Identidad = ca.Identidad")->fetchAll(PDO::FETCH_UNIQUE | PDO::FETCH_ASSOC);
    $tests[] = ['rut-normalizacion-puntos-guion-espacios', $rows['B']['Identidad'], 'RUT:141560646'];
    $tests[] = ['rut-historico-codaux-no-asignado', $rows['B']['Primero'], 'A'];
    $tests[] = ['rut-historico-global-fecha', $rows['B']['Fecha'], '2024-01-01'];
    $tests[] = ['rut-historico-global-vendedor', $rows['B']['Vendedor'], 'otro-vendedor'];
    $tests[] = ['rut-evento-unico-primero', $rows['D']['Primero'], 'C'];
    $tests[] = ['rut-fallback-null', $rows[100]['Identidad'], 'CODAUX:100'];
    $tests[] = ['rut-fallback-vacio', $rows[200]['Identidad'], 'CODAUX:200'];
    $tests[] = ['rut-dv-k-mayuscula', $rows['K']['Identidad'], 'RUT:76123456K'];
    $tests[] = ['rut-empate-nroint', $rows['K']['Primero'], 'L'];
    $tests[] = ['rut-empate-vendedor', $rows['K']['Vendedor'], '479'];

    $memory->exec('CREATE TABLE cwtauxven (CodAux TEXT, VenCod TEXT)');
    $memory->exec("INSERT INTO cwtauxven SELECT CodAux, '479' FROM cwtauxi");
    $memory->exec('CREATE TABLE iw_gmovi (NroInt INTEGER, Tipo TEXT, TotLinea REAL)');
    $memory->exec('INSERT INTO iw_gmovi SELECT NroInt, Tipo, 241536 FROM iw_gsaen');
    $memory->sqliteCreateFunction('YEAR', static fn(string $date): int => (int)substr($date, 0, 4));
    $memory->sqliteCreateFunction('MONTH', static fn(string $date): int => (int)substr($date, 5, 2));
    $pdo = new ConcursoClientPDO([[], [['cantidad' => 0]]]);
    $db = new Database($pdo, []);
    $analytics = new AnalyticsService($db);
    $analytics->clientesNuevosCalendarioForUser(1, ['anio' => 2026]);
    (new ReflectionMethod(ConcursoVentasService::class, 'clientesNuevosPuntuables'))->invoke(
        new ConcursoVentasService($db, $analytics), ['479'], 2026, 10);
    foreach ($pdo->executions as $index => [$query, $params]) {
        $query = str_replace(['[PRODIN].[softland].', 'CONVERT(varchar(80), a.RutAux)', ' + '],
            ['', 'CAST(a.RutAux AS TEXT)', ' || '], $query);
        $query = preg_replace('/CAST\((\w+\.Fecha) AS date\)/i', 'DATE($1)', $query);
        $query = preg_replace('/CONVERT\(date,\s*(\w+\.Fecha)\)/i', 'DATE($1)', $query);
        $stmt = $memory->prepare($query);
        foreach ($params as $position => $value) $stmt->bindValue($position + 1, $value,
            $index === 1 && $position === count($params) - 1 ? PDO::PARAM_INT : PDO::PARAM_STR);
        $stmt->execute();
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        $tests[] = [$index === 0 ? 'calendario-codaux-cantidad' : 'fallback-rut-cantidad', $row[$index === 0 ? 'Cantidad' : 'cantidad'], $index === 0 ? 7 : 4];
        if ($index === 0) $tests[] = ['calendario-codaux-venta', $row['Monto'], 1690752];
    }

    // Claudia es propietaria; la primera factura pertenece a Norelbys. RUT con historia ajena.
    $memory->exec("INSERT INTO cwtauxi VALUES ('78103135','14.156.064-6'),('OTRO-CODIGO','14.156.064-6'),('ANTIGUO','14.156.064-6')");
    $memory->exec("INSERT INTO cwtauxven VALUES ('78103135','454'),('OTRO-CODIGO','454'),('ANTIGUO','454')");
    $memory->exec("INSERT INTO iw_gsaen VALUES ('78103135','630','2026-10-13',1001,381156,'F','V'),('OTRO-CODIGO','630','2026-10-14',1002,381157,'F','V'),('ANTIGUO','630','2024-01-01',1003,381158,'F','V'),('ANTIGUO','630','2026-10-14',1004,381159,'F','V')");
    $memory->exec("INSERT INTO iw_gmovi VALUES (1001,'F',250000),(1002,'F',200000),(1004,'F',300000)");
    $pdo = new ConcursoClientPDO([[]]);
    $analytics = new AnalyticsService(new Database($pdo, []));
    (new ReflectionProperty(AnalyticsService::class, 'vendorRelationsByUserId'))->setValue($analytics,
        [91 => [['cod_vendedor' => '454', 'tipo' => 'P']]]);
    $analytics->clientesNuevosCalendarioForUser(91, ['anio' => 2026]);
    [$query, $params] = $pdo->executions[0];
    $query = str_replace('[PRODIN].[softland].', '', $query);
    $query = preg_replace('/CONVERT\(date,\s*(\w+\.Fecha)\)/i', 'DATE($1)', $query);
    $stmt = $memory->prepare($query);
    $stmt->execute($params);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    $tests[] = ['calendario-claudia-codaux-independientes-mismo-rut', $row['Cantidad'], 2];
    $tests[] = ['calendario-claudia-primera-compra-octubre', $row['Mes'], 10];
    $tests[] = ['calendario-claudia-ventas-ajenas-sin-condicionar-nuevo', $row['Monto'], 450000.0];
}

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
