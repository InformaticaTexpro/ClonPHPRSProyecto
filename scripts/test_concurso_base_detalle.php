<?php
declare(strict_types=1);

// Prueba aislada: base oficial local de solo lectura y fuente comercial simulada; sin conexiones ni escrituras.
function env(string $key, mixed $default = null): mixed
{
    return $key === 'CONCURSO_CIERRES_DIR' ? sys_get_temp_dir() . '/concurso-base-lectura-' . getmypid() : $default;
}
require_once dirname(__DIR__) . '/api/src/SharedServiceHelpers.php';
require_once dirname(__DIR__) . '/api/src/Security.php';

class Database
{
    public bool $admin = false;
    public function fetchOne(string $sql, array $params = []): ?array { return $this->admin ? ['id' => 1] : null; }
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
$query = ['anio' => '2026', 'mes' => '10', 'categoria' => 'QUIMICOS', 'detalle' => 'base',
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
$privateSource = ConcursoBaseOlgaDetalle::load();
$hasPrivateMovements = (bool)$privateSource['movimientos'];
rejects(fn() => $service->concursoProductosUsuario($payload, $query + ['periodoBase' => '2026-01']), 400);
rejects(fn() => $service->concursoProductosUsuario($payload, $query + ['periodoBase' => '2027-06']), 400);
rejects(fn() => $service->concursoProductosUsuario([], $query), 401);
foreach (ConcursoBaseOficialStore::CATEGORIAS as $category) {
    $manualQuery = array_replace($query, ['categoria' => $category]);
    $manual = $service->concursoProductosUsuario(['sub' => 49], $manualQuery);
    check($manual['baseManual'] === false && $manual['fuenteBase'] === 'PRIVADA'
        && $manual['promedioBase'] == $olga['categorias'][$category]['promedioBase'], 'Olga con respaldo privado e importe intacto: ' . $category);
    check(array_column($manual['meses'], 'periodo') === ['2026-07', '2026-08', '2026-09'], 'Olga no muestra junio');
    if ($hasPrivateMovements) {
        $privateMonth = $service->concursoProductosUsuario(['sub' => 49], $manualQuery + ['periodoBase' => '2026-09']);
        check(is_array($privateMonth['documentos']) && $privateMonth['fuenteBase'] === 'PRIVADA', 'consulta mensual privada sin mensaje manual');
    } else {
        rejects(fn() => $service->concursoProductosUsuario(['sub' => 49], $manualQuery + ['periodoBase' => '2026-09']), 409);
    }
    rejects(fn() => $service->concursoProductosUsuario(['sub' => 49], $manualQuery + ['periodoBase' => '2026-06']), 400);
}
check($before === $analytics->calls, 'errores y base manual no consultan documentos');
rejects(fn() => $service->concursoMiBaseDetalle($payload + ['usuarioId' => 49]), 403);
rejects(fn() => $service->concursoMiBaseDetalle([]), 401);
check($service->concursoMiBaseDetalle(['sub' => 49])['detalle']['usuarioId'] === 49, 'Olga accede a su propia fuente');
rejects(fn() => $service->route($payload + ['is_admin' => true], 'GET', '/comercial/concurso-ventas/productos',
    array_replace($query, ['vendedorId' => '49']), []), 403);
rejects(fn() => $service->route($payload + ['is_admin' => true], 'GET', '/comercial/concurso-ventas/productos',
    array_replace($query, ['vendedorId' => '049']), []), 403);
rejects(fn() => (new ConcursoPromediosService($db, $analytics))->route($payload, 'GET', '/concurso-promedios/detalle', [], []), 403);
$db->admin = true;
$adminService = new ConcursoPromediosService($db, $analytics);
$private = $adminService->route($payload, 'GET', '/concurso-promedios/base-privada', [], []);
check($private['periodo']['meses'] === ['2026-07', '2026-08', '2026-09'], 'administración consulta período privado');
$records = array_column($private['registros'], null, 'categoria');
check(array_values($records['QUIMICOS']['ventas_mensuales']) === [0, 264948, 422130], 'resumen químicos exacto');
check(array_values($records['TRAT_AGUA']['ventas_mensuales']) === [371057, 6395656.20, 15980785.50], 'resumen tratamiento exacto');
foreach (['ACCESORIOS', 'AEROSOLES'] as $category) check(array_values($records[$category]['ventas_mensuales']) === [0, 0, 0], 'ceros mensuales ' . $category);
if ($hasPrivateMovements) {
    $adminMonth = $adminService->route($payload, 'GET', '/concurso-promedios/base-privada', ['categoria' => 'TRAT_AGUA', 'periodo' => '2026-09'], []);
    check($adminMonth['importeOficial'] === 15980785.50, 'administración consulta monto privado de septiembre');
} else {
    rejects(fn() => $adminService->route($payload, 'GET', '/concurso-promedios/base-privada', ['categoria' => 'TRAT_AGUA', 'periodo' => '2026-09'], []), 409);
}
check($service->route($payload + ['is_admin' => true], 'GET', '/comercial/concurso-ventas/productos',
    array_replace($query, ['vendedorId' => '49']), [])['fuenteBase'] === 'PRIVADA', 'gerencia exige permiso administrativo para fuente privada');
check($before === $analytics->calls, 'consulta privada no carga ventas ni recalcula');
check(hash_file('sha256', $officialPath) === $hash, 'JSON oficial sin cambios');

// Datos de prueba tomados del adjunto: no se escriben en la fuente privada de producción.
$septemberExample = [];
foreach ([
    ['2026-09-16', 380568, 'PQ04170010', 'CLORO TEX-L (ENV.010 KGS.)', 10, 43696],
    ['2026-09-09', 380404, 'PQ12040025', 'ZEOLITA (Env. 025 KG)', 50, 333228],
    ['2026-09-07', 380350, 'PQ04170020', 'CLORO TEX-L (ENV.020 KGS.)', 20, 45206],
] as [$date, $folio, $code, $description, $quantity, $amount]) $septemberExample[] = [
    'mes' => 9, 'categoria' => 'QUIMICOS', 'fecha' => $date, 'tipo' => 'F', 'folio' => $folio,
    'codigoVendedor' => '479', 'codigoProducto' => $code, 'producto' => $description, 'cantidad' => $quantity,
    'tipoParticipacion' => 'P', 'TotLinea' => $amount, 'factorAplicado' => 1.0, 'montoComputableBase' => $amount,
];
$exampleDocuments = ConcursoBaseOlgaDetalle::documentos($septemberExample, 'QUIMICOS', 9);
check(count($exampleDocuments) === 3, 'ejemplo septiembre: exactamente tres movimientos');
check(array_sum(array_column($exampleDocuments, 'atribuida')) === 422130, 'ejemplo septiembre: total atribuido 422130');
check(array_column($exampleDocuments, 'folio') === [380568, 380404, 380350], 'folios del ejemplo');
check(array_column($exampleDocuments, 'codigoProducto') === ['PQ04170010', 'PQ12040025', 'PQ04170020'], 'códigos de producto');
check(array_column($exampleDocuments, 'porcentaje') === [100.0, 100.0, 100.0], 'vendedor 479 reconoce 100%');
check($exampleDocuments[0]['producto'] === 'CLORO TEX-L (ENV.010 KGS.)' && $exampleDocuments[0]['cantidad'] === 10, 'descripción y cantidad');
$sharedExample = array_replace($septemberExample[0], ['mes' => 8, 'categoria' => 'TRAT_AGUA', 'codigoVendedor' => '8479',
    'tipoParticipacion' => 'C', 'TotLinea' => 1000000, 'factorAplicado' => .5, 'montoComputableBase' => 500000]);
$sharedDocuments = ConcursoBaseOlgaDetalle::documentos(array_merge($septemberExample, [$sharedExample]), 'TRAT_AGUA', 8);
check(count($sharedDocuments) === 1 && $sharedDocuments[0]['porcentaje'] === 50.0, 'vendedor 8479 reconoce 50% y filtra categoría/mes');
check(array_sum(array_column($sharedDocuments, 'atribuida')) === 500000 && $sharedDocuments[0]['original'] === 1000000, 'total usa montoComputableBase, no TotLinea');
$credit = array_replace($sharedExample, ['tipo' => 'N', 'TotLinea' => -1000000, 'montoComputableBase' => -500000]);
$creditDocuments = ConcursoBaseOlgaDetalle::documentos([$credit], 'TRAT_AGUA', 8);
check($creditDocuments[0]['original'] === -1000000 && $creditDocuments[0]['atribuida'] === -500000, 'nota de crédito conserva signo');
check(ConcursoBaseOlgaDetalle::documentos($septemberExample, 'ACCESORIOS', 7) === [], 'combinación sin movimientos después de filtrar');

if ($hasPrivateMovements) {
    check(count($privateSource['movimientos']) === 141 && count($privateSource['detallePorFolio']) === 44
        && count($privateSource['detallePorProducto']) === 78, 'controles de la fuente completa');
    foreach (['QUIMICOS' => [7 => 0, 8 => 264948, 9 => 422130],
        'TRAT_AGUA' => [7 => 371057, 8 => 6395656.20, 9 => 15980785.50]] as $category => $months) {
        foreach ($months as $month => $amount) {
            $result = ConcursoBaseOlgaDetalle::consulta(['categoria' => $category, 'periodo' => sprintf('2026-%02d', $month)]);
            check(abs($result['total'] - $amount) < .005, 'total real ' . $category . ' mes ' . $month);
            if ($category === 'QUIMICOS' && $month === 9) check(count($result['documentos']) === 3, 'tres movimientos reales de septiembre');
        }
    }
} else {
    echo "PENDIENTE: el JSON local tiene 0 movimientos; no se validaron los totales contra la fuente completa de 141 registros.\n";
}
echo 'Ejemplo del adjunto: folios ' . implode(', ', array_column($exampleDocuments, 'folio')) . '; total = ' . array_sum(array_column($exampleDocuments, 'atribuida')) . "; 3 movimientos (prueba aislada).\n";
echo "OK: $checks comprobaciones; base oficial local de {$normal['vendedorNombre']} y Olga; fuente comercial simulada, sin conexiones ni escrituras.\n";
