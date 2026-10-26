<?php
declare(strict_types=1);

// Fuente simulada, base oficial de solo lectura y cierres exclusivamente en un directorio temporal.
require_once dirname(__DIR__) . '/api/src/SharedServiceHelpers.php';
require_once dirname(__DIR__) . '/api/src/Security.php';
$tempDir = sys_get_temp_dir() . '/concurso-revisiones-' . bin2hex(random_bytes(8));
function env(string $key, mixed $default = null): mixed
{
    global $tempDir;
    return match ($key) { 'CONCURSO_CIERRES_DIR' => $tempDir, 'JWT_SECRET' => 'clave-aislada-para-pruebas', default => $default };
}
class RevisionStatement extends PDOStatement
{
    private array $rows = [];
    public function __construct(private string $sql, private Database $db) {}
    public function execute(?array $params = null): bool
    {
        if (substr_count($this->sql, '?') !== count($params ?? [])) throw new RuntimeException('Parámetros SQL desalineados');
        $this->db->executions[] = [$this->sql, $params];
        $month = (int)substr($params[0], 5, 2);
        $this->rows = [];
        foreach ($this->db->relations as $relation) {
            $code = $relation['codigoAsociado'];
            if (count($params) > 2 && !in_array($code, array_slice($params, 2), true)) continue;
            $this->rows[] = ['codigoVendedor' => $code, 'venta' => $this->db->amounts[$month][$relation['usuarioId']]];
        }
        return true;
    }
    public function fetchAll(int $mode = PDO::FETCH_DEFAULT, mixed ...$args): array { return $this->rows; }
}
class RevisionPDO extends PDO
{
    public function __construct(private Database $db) {}
    public function prepare(string $query, array $options = []): PDOStatement|false { return new RevisionStatement($query, $this->db); }
}
class Database
{
    public array $relations = [], $amounts = [], $executions = [];
    public bool $allowed = true;
    public function softland(): PDO { return new RevisionPDO($this); }
    public function softlandAvailable(): bool { return true; }
    public function fetchOne(string $sql, array $params = []): ?array { return $this->allowed ? ['id' => $params[0], 'nombre' => 'Administrador de prueba'] : null; }
    public function fetchAll(string $sql, array $params = []): array
    {
        if (str_contains($sql, 'usuario_vendedor')) return $this->relations;
        if (str_contains($sql, 'vendedor_meta')) return array_map(static fn(array $r): array => ['usuario_id' => $r['usuarioId'], 'meta' => 20000000],
            array_values(array_filter($this->relations, static fn(array $r): bool => count($params) === 1 || $r['usuarioId'] === $params[1])));
        throw new RuntimeException('Consulta inesperada en la prueba');
    }
}
class AnalyticsService
{
    public array $clientCalls = [];
    public int $sourceCalls = 0;
    public function __construct(private Database $db) {}
    public function applySharedSalesToVendorRows(array $rows, mixed ...$rest): array
    {
        return array_map(static fn(array $row): array => $row + ['ventaBaseAtribuida' => $row['venta'], 'ventaCompartidaRecibida' => 0.0, 'ventaCompartidaEntregada' => 0.0], $rows);
    }
    public function concursoClientes(array $relations, int $month, ?int $user = null, mixed ...$rest): array
    {
        $this->clientCalls[] = $user;
        $summary = [];
        foreach ($relations as $relation) if ($user === null || $user === $relation['usuarioId']) $summary[$relation['usuarioId']] = [
            'clientesNuevos' => 0, 'puntosNuevos' => 0.0, 'clientesRecuperados' => 0, 'puntosRecuperados' => 0.0];
        return ['resumen' => $summary, 'clientes' => []];
    }
    public function concursoPromediosFuente(string $desde, string $hasta, bool $products = false): array
    {
        $this->sourceCalls++;
        $month = (int)substr($desde, 5);
        $sales = [];
        foreach ($this->db->relations as $relation) {
            $id = $relation['usuarioId'];
            $amount = $this->db->amounts[$month][$id];
            $sales[] = ['documentoClave' => 'D' . $id, 'codigoVendedor' => $relation['codigoAsociado'], 'cuentaCategoria' => 'Q',
                'tipo' => 'F', 'folio' => $id, 'fecha' => $desde . '-15', 'mes' => $month, 'cliente' => 'Cliente simulado', 'clienteCodigo' => 'CLI', 'original' => $amount,
                'productos' => [['codigoProducto' => 'P1', 'producto' => 'Producto simulado', 'cantidad' => 1, 'original' => $amount]]];
        }
        return ['relaciones' => $this->db->relations, 'ventas' => $sales, 'asignaciones' => [], 'catalogo' => ['Q' => 'QUIMICOS']];
    }
}
require_once dirname(__DIR__) . '/api/src/GerenciaService.php';
require_once dirname(__DIR__) . '/api/src/ConcursoVentasService.php';
$checks = 0;
function check(bool $condition, string $label): void
{
    global $checks;
    if (!$condition) throw new RuntimeException('FALLO: ' . $label);
    $checks++;
}
function rejects(callable $call, int $code): void
{
    try { $call(); } catch (RuntimeException $error) { check($error->getCode() === $code, 'rechazo ' . $code); return; }
    throw new RuntimeException('Se esperaba rechazo ' . $code);
}
$basePath = dirname(__DIR__) . '/api/storage/concurso-ventas-2026/base-oficial.json';
$baseHash = hash_file('sha256', $basePath);
try {
    $base = (new ConcursoBaseOficialStore())->load();
    $olga = array_values(array_filter($base['vendedores'], static fn(array $v): bool => $v['usuarioId'] === 49))[0];
    check(array_map(static fn(array $v): int => (int)$v['promedioBase'], $olga['categorias']) === [
        'QUIMICOS' => 171770, 'ACCESORIOS' => 0, 'TRAT_AGUA' => 5686875, 'AEROSOLES' => 0], 'valores oficiales exactos de Olga');
    $db = new Database();
    $vendors = array_merge([$olga], array_slice(array_values(array_filter($base['vendedores'], static fn(array $v): bool => $v['usuarioId'] !== 49)), 0, 2));
    foreach ($vendors as $i => $vendor) {
        $id = $vendor['usuarioId'];
        $db->relations[] = ['usuarioId' => $id, 'codigoPrincipal' => $vendor['codigoPrincipal'], 'vendedor' => $vendor['vendedorNombre'],
            'codigoAsociado' => 'TEST' . $i, 'claveCompartida' => 'TEST' . $i, 'tipo' => 'P'];
        foreach ([9, 10, 11, 12] as $month) $db->amounts[$month][$id] = 1000000.0;
    }
    $ids = array_column($db->relations, 'usuarioId');
    $other = $ids[1]; $untouched = $ids[2];
    $analytics = new AnalyticsService($db);
    $service = new GerenciaService($db, $analytics);
    (new ReflectionProperty(GerenciaService::class, 'vendorRelations'))->setValue($service, $db->relations);
    $admin = ['sub' => 1, 'is_admin' => true];
    $route = static fn(string $action, array $body): array => $service->route($admin, 'POST', '/comercial/concurso-ventas/' . $action, [], ['anio' => 2026, 'mes' => 10] + $body);
    $monthQuery = ['anio' => '2026', 'mes' => '10'];
    $vendorQuery = ['anio' => '2026', 'mes' => '9', 'categoria' => 'QUIMICOS', 'detalle' => 'venta'];
    foreach (['concursoDetalleUsuario', 'concursoPuntajeUsuario', 'concursoClientesUsuario', 'concursoProductosUsuario'] as $method) {
        rejects(fn() => $service->$method(['sub' => 49], $vendorQuery), 400);
    }
    check(!ConcursoVentasService::isVisibleForPeriod(2026, 9) && !ConcursoVentasService::isVisibleForPeriod(2027, 1), 'solo meses oficiales visibles');
    rejects(fn() => $service->concursoMiBaseDetalle(['sub' => $other, 'usuarioId' => 49]), 403);
    rejects(fn() => $service->concursoMiBaseDetalle([]), 401);
    $private = $service->concursoMiBaseDetalle(['sub' => 49])['detalle'];
    foreach (['QUIMICOS', 'TRAT_AGUA'] as $category) {
        $values = $private['resumen'][$category];
        check(abs(array_sum($values['meses']) - $values['acumuladoComputable']) < .001, 'resumen mensual ' . $category);
        check((int)round($values['acumuladoComputable'] / $private['divisor']) === (int)$olga['categorias'][$category]['promedioBase'], 'divisor de origen ' . $category);
    }
    check(
    is_array($private['movimientos'])
    && count($private['movimientos']) === 141,
    'fuente privada completa instalada'
);
    $diagnostic = (new ConcursoPromediosService($db, $analytics))->route($admin, 'GET', '/concurso-promedios/diagnostico', [], []);
    check($diagnostic['meses'][0]['mes'] === 9 && $diagnostic['meses'][0]['estado'] === 'PRUEBA', 'septiembre administrativo conservado');
    $open = $service->concursoDetalleUsuario(['sub' => 49], $monthQuery)['row'];
    $db->amounts[10][49] += 1000000;
    check($service->concursoDetalleUsuario(['sub' => 49], $monthQuery)['row']['venta'] > $open['venta'], 'mes abierto dinámico');
    $db->allowed = false;
    rejects(fn() => $route('cerrar', []), 403);
    $db->allowed = true;
    check($route('cerrar', [])['estadoMes'] === 'CERRADO', 'cierre normal con todos los vendedores');
    $store = new ConcursoCierreStore();
    $closed = $store->load(10);
    check(count($closed['snapshot']['vendedores']) === 3, 'formato uniforme sin vendedor especial');
    // Simular una base histórica diferente de la oficial vigente, sin tocar la base real.
    foreach ($closed['snapshot']['vendedores'] as &$vendor) if ($vendor['usuarioId'] === 49) {
        $vendor['productos'][0]['promedioBase'] = 123.0;
        $vendor['productos'][0]['superacion'] = $vendor['productos'][0]['ventaMes'] - 123;
        $vendor['productos'][0]['puntos'] = GerenciaService::puntosProductosConcurso($vendor['productos'][0]['superacion']);
        $vendor['productosPuntos'] = array_sum(array_column($vendor['productos'], 'puntos'));
        $vendor['totalMes'] = $vendor['puntosMeta'] + $vendor['puntosNuevos'] + $vendor['puntosRecuperados'] + $vendor['productosPuntos'];
    }
    unset($vendor);
    $store->locked(fn() => $store->save($closed, 10));
    $byId = static fn(array $saved): array => array_column($saved['snapshot']['vendedores'], null, 'usuarioId');
    $original = $byId($closed);
    $calls = $analytics->sourceCalls;
    $db->amounts[10][49] = 50000000.0;
    check($service->concursoDetalleUsuario(['sub' => 49], $monthQuery)['row']['venta'] === $original[49]['venta'], 'cierre fijo aunque cambia la fuente');
    check($analytics->sourceCalls === $calls, 'lectura cerrada sin fuente comercial');
    // Cierre posterior: una revisión de octubre no debe modificar noviembre.
    $service->route($admin, 'POST', '/comercial/concurso-ventas/cerrar', [], ['anio' => 2026, 'mes' => 11]);
    $laterHash = hash_file('sha256', $tempDir . '/2026-11.json');
    $beforeHash = hash_file('sha256', $tempDir . '/2026-10.json');
    $analytics->clientCalls = []; $db->executions = [];
    $preview = $route('revisar', ['vendedores' => [49], 'motivo' => 'Corregir documentos']);
    check($preview['guardado'] === false && count($preview['comparacion']) === 1, 'vista previa individual sin guardar');
    check($analytics->clientCalls === [49], 'solo se solicita recalcular el vendedor seleccionado');
    check(count($db->executions) === 1 && array_slice($db->executions[0][1], 2) === ['TEST0'], 'ventas limitadas a códigos seleccionados');
    check($preview['comparacion'][0]['anterior']['venta'] !== $preview['comparacion'][0]['recalculado']['venta'], 'comparación antes y recalculado');
    check(hash_file('sha256', $tempDir . '/2026-10.json') === $beforeHash, 'cancelación no modifica el cierre');
    rejects(fn() => $route('revisar', ['revision' => $preview['revision'], 'confirmar' => false]), 400);
    check(hash_file('sha256', $tempDir . '/2026-10.json') === $beforeHash, 'rechazo sin confirmación no guarda');
    $calls = $analytics->sourceCalls;
    $route('revisar', ['revision' => $preview['revision'], 'confirmar' => true]);
    check($analytics->sourceCalls === $calls, 'confirmación guarda exactamente lo comparado sin recalcular');
    $revised = $store->load(10); $current = $byId($revised);
    check($revised['estado'] === 'CERRADO' && $revised['fechaCierre'] === $closed['fechaCierre'], 'estado y fecha de cierre conservados');
    check($current[$other] === $original[$other] && $current[$untouched] === $original[$untouched], 'otros snapshots individuales intactos');
    check($revised['revisiones'][0]['anteriores'][49] === $original[49] && $current[49]['revision']['numero'] === 1, 'auditoría conserva el resultado anterior');
    check($current[49]['productos'][0]['promedioBase'] == $original[49]['productos'][0]['promedioBase'], 'base histórica congelada');
    check($current[49]['productos'][0]['promedioBase'] == 123 && (float)$olga['categorias']['QUIMICOS']['promedioBase'] !== 123.0, 'no sustituye base histórica por base vigente');
    rejects(fn() => $route('revisar', ['revision' => $preview['revision'], 'confirmar' => true]), 409);
    $db->amounts[10][$other] = 55000000.0;
    $analytics->clientCalls = [];
    $multiple = $route('revisar', ['vendedores' => [49, $other], 'motivo' => 'Revisión de dos vendedores']);
    check($analytics->clientCalls === [49, $other] && count($multiple['comparacion']) === 2, 'revisión múltiple selectiva');
    $route('revisar', ['revision' => $multiple['revision'], 'confirmar' => true]);
    $last = $byId($store->load(10));
    check($last[$untouched] === $original[$untouched] && $last[$other]['venta'] == 55000000, 'solo seleccionados actualizados');
    check(hash_file('sha256', $tempDir . '/2026-11.json') === $laterHash, 'cierre posterior intacto');
    $calls = $analytics->sourceCalls;
    $result = $service->concursoDetalleUsuario(['sub' => 49], ['anio' => '2026', 'mes' => '11'])['row'];
    check(array_column($result['mesesOficiales'], 'mes') === [10, 11], 'acumulado sin septiembre');
    check($result['acumulado'] == $last[49]['totalMes'] + $byId($store->load(11))[49]['totalMes'], 'acumulado toma cierre revisado y cierre posterior vigente');
    $ranking = $service->route($admin, 'GET', '/comercial/concurso-ventas/resumen', $monthQuery, [])['items'];
    usort($ranking, static fn(array $a, array $b): int => $b['totalMes'] <=> $a['totalMes']);
    check($ranking[0]['usuarioId'] !== $untouched && $analytics->sourceCalls === $calls, 'ranking con resultados vigentes sin consultar ventas');
    $correction = $route('revisar', ['vendedores' => [49], 'motivo' => 'Corregir explícitamente base histórica', 'corregirBase' => true]);
    check($correction['comparacion'][0]['recalculado']['productos'][0]['promedioBase'] == 171770, 'corrección de base solo explícita');
    $route('revisar', ['revision' => $correction['revision'], 'confirmar' => true]);
    check($byId($store->load(10))[$untouched] === $original[$untouched], 'corrección explícita mantiene otros vendedores');
    check(hash_file('sha256', $basePath) === $baseHash, 'cierres y revisiones no modifican la base oficial');
    echo "OK concurso revisiones: $checks comprobaciones; fuente simulada, cierres temporales, sin conexiones.\n";
} finally {
    if (is_dir($tempDir)) {
        foreach (scandir($tempDir) as $file) if ($file !== '.' && $file !== '..') unlink($tempDir . '/' . $file);
        rmdir($tempDir);
    }
}
