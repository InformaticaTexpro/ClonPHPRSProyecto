<?php
declare(strict_types=1);

// Prueba aislada: base oficial local de solo lectura y fuente comercial simulada; sin conexiones ni escrituras.
require_once dirname(__DIR__) . '/api/src/SharedServiceHelpers.php';
require_once dirname(__DIR__) . '/api/src/Security.php';

class Database
{
    public function fetchOne(string $sql, array $params = []): ?array { return null; }
}

class AnalyticsService
{
    public int $calls = 0;
    public function __construct(public array $source) {}
    public function concursoPromediosFuente(string $desde, string $hasta, bool $productos = false): array
    {
        $this->calls++;
        $source = $this->source;
        foreach ($source['ventas'] as &$sale) {
            $sale['mes'] = (int)substr($desde, 5);
            $sale['fecha'] = $desde . '-15';
        }
        return $source;
    }
}

require_once dirname(__DIR__) . '/api/src/GerenciaService.php';

$checks = 0;
function check(bool $condition, string $label): void
{
    global $checks;
    if (!$condition) throw new RuntimeException('FALLO: ' . $label);
    $checks++;
}
function rejects(callable $call, int $code): void
{
    try { $call(); } catch (RuntimeException $e) { check($e->getCode() === $code, 'rechazo ' . $code); return; }
    throw new RuntimeException('Se esperaba rechazo ' . $code);
}

$officialPath = dirname(__DIR__) . '/api/storage/concurso-ventas-2026/base-oficial.json';
$hash = hash_file('sha256', $officialPath);
$base = (new ConcursoBaseOficialStore())->load();
if ($base === null) throw new RuntimeException('Falta la base oficial para esta prueba de lectura.');
$normal = $olga = null;
foreach ($base['vendedores'] as $vendor) {
    if ($vendor['usuarioId'] === 49 && $vendor['codigoPrincipal'] === '8479') $olga = $vendor;
    if ($normal === null && $vendor['usuarioId'] !== 49 && (float)($vendor['categorias']['QUIMICOS']['meses'][$base['periodoDesde']] ?? 0) > 0) $normal = $vendor;
}
if (!$normal || !$olga) throw new RuntimeException('Faltan los vendedores de referencia en la base local.');
$period = $base['periodoDesde'];
$expected = (float)$normal['categorias']['QUIMICOS']['meses'][$period];
$relations = [];
foreach ([$normal, $olga] as $i => $vendor) $relations[] = [
    'usuarioId' => $vendor['usuarioId'], 'codigoPrincipal' => $vendor['codigoPrincipal'],
    'vendedor' => $vendor['vendedorNombre'], 'codigoAsociado' => 'TEST' . $i, 'claveCompartida' => 'TEST' . $i, 'tipo' => 'P',
];
$sales = [];
foreach ([$expected, 999] as $i => $amount) $sales[] = [
    'documentoClave' => 'D' . $i, 'codigoVendedor' => 'TEST' . $i, 'cuentaCategoria' => 'Q',
    'tipo' => 'F', 'folio' => 100 + $i, 'cliente' => 'Cliente simulado', 'clienteCodigo' => 'CLI', 'original' => $amount,
    'productos' => [
        ['codigoProducto' => 'P1', 'producto' => 'Producto simulado 1', 'cantidad' => 2, 'original' => $amount * .4],
        ['codigoProducto' => 'P2', 'producto' => 'Producto simulado 2', 'cantidad' => 3, 'original' => $amount * .6],
    ],
];
$analytics = new AnalyticsService(['relaciones' => $relations, 'ventas' => $sales, 'asignaciones' => [], 'catalogo' => ['Q' => 'QUIMICOS']]);
$db = new Database();
$service = new GerenciaService($db, $analytics);
(new ReflectionProperty(GerenciaService::class, 'vendorRelations'))->setValue($service, $relations);
$payload = ['sub' => $normal['usuarioId']];
$query = ['anio' => '2026', 'mes' => '9', 'categoria' => 'QUIMICOS', 'detalle' => 'base',
    'usuarioId' => $olga['usuarioId'], 'vendedorId' => $olga['usuarioId']];
$summary = $service->concursoProductosUsuario($payload, $query);
check($summary['baseManual'] === false, 'vendedor normal');
check($summary['promedioBase'] === (float)$normal['categorias']['QUIMICOS']['promedioBase'], 'promedio oficial intacto');
check(array_column($summary['meses'], 'venta', 'periodo') === array_map('floatval', $normal['categorias']['QUIMICOS']['meses']), 'meses oficiales intactos');
check($analytics->calls === 0, 'resumen sin cargar documentos');
$detail = $service->concursoProductosUsuario($payload, $query + ['periodoBase' => $period]);
check(count($detail['documentos']) === 2, 'productos del usuario autenticado, no del usuario manipulado');
check(array_unique(array_column($detail['documentos'], 'codigoVendedor')) === ['TEST0'], 'aislamiento de vendedor');
check(abs($detail['total'] - $expected) < .005 && $detail['importeOficial'] === $expected && $detail['coincide'], 'conciliación correcta');
check(abs(array_sum(array_column($detail['documentos'], 'atribuida')) - $detail['total']) < .005, 'suma del detalle');
$adminResult = (new ConcursoPromediosService($db, $analytics))->calcular($normal['usuarioId'], 'QUIMICOS', (int)substr($period, 5), $period, $period);
check($detail['documentos'] === $adminResult['documentos'] && $detail['total'] === $adminResult['total'], 'mismo cálculo de Administración');
$analytics->source['ventas'][0]['original'] += 1;
$analytics->source['ventas'][0]['productos'][0]['original'] += 1;
$changed = $service->concursoProductosUsuario($payload, $query + ['periodoBase' => $period]);
check(!$changed['coincide'] && $changed['importeOficial'] === $expected && abs($changed['total'] - $expected - 1) < .005, 'diferencia informada sin sustituir oficial');
check($service->concursoProductosUsuario($payload, $query) === $summary, 'resumen oficial no cambia');
$sale = $service->concursoProductosUsuario($payload, array_replace($query, ['detalle' => 'venta']));
check(count($sale['documentos']) === 2 && abs($sale['total'] - $expected - 1) < .005, 'venta actual conserva detalle');
$before = $analytics->calls;
rejects(fn() => $service->concursoProductosUsuario($payload, $query + ['periodoBase' => '2026-01']), 400);
rejects(fn() => $service->concursoProductosUsuario($payload, $query + ['periodoBase' => '2027-06']), 400);
rejects(fn() => $service->concursoProductosUsuario([], $query), 401);
foreach (ConcursoBaseOficialStore::CATEGORIAS as $category) {
    $manualQuery = array_replace($query, ['categoria' => $category]);
    $manual = $service->concursoProductosUsuario(['sub' => 49], $manualQuery);
    check($manual['baseManual'] === true && $manual['promedioBase'] === (float)$olga['categorias'][$category]['promedioBase'], 'Olga manual e importe intacto: ' . $category);
    rejects(fn() => $service->concursoProductosUsuario(['sub' => 49], $manualQuery + ['periodoBase' => $period, 'baseManual' => false]), 409);
}
check($before === $analytics->calls, 'errores y base manual no consultan documentos');
rejects(fn() => (new ConcursoPromediosService($db, $analytics))->route($payload, 'GET', '/concurso-promedios/detalle', [], []), 403);
check(hash_file('sha256', $officialPath) === $hash, 'JSON oficial sin cambios');
echo "OK: $checks comprobaciones; base oficial local de {$normal['vendedorNombre']} y Olga; fuente comercial simulada, sin conexiones ni escrituras.\n";
