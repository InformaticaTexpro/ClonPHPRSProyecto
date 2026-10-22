<?php
declare(strict_types=1);

// Fakes en memoria: ninguna conexión ni escritura contra bases reales.
require_once dirname(__DIR__) . '/api/src/SharedServiceHelpers.php';
require_once dirname(__DIR__) . '/api/src/Security.php';
require_once dirname(__DIR__) . '/api/src/AnalyticsService.php';
require_once dirname(__DIR__) . '/api/src/DashboardService.php';
require_once dirname(__DIR__) . '/api/src/RrhhService.php';

final class SharedTestTransaction
{
    public bool $active = false;
    private array $snapshot;
    public function __construct(private Database $db) {}
    public function beginTransaction(): void { $this->active = true; $this->snapshot = [$this->db->assignments, $this->db->notifications]; }
    public function commit(): void { $this->active = false; }
    public function inTransaction(): bool { return $this->active; }
    public function rollBack(): void { [$this->db->assignments, $this->db->notifications] = $this->snapshot; $this->active = false; }
}
final class SharedTestStatement extends PDOStatement
{
    private array $rows = [];
    public function __construct(private Database $db, private string $sql) {}
    public function execute(?array $params = null): bool
    {
        if (!preg_match('/^\s*SELECT\b/i', $this->sql)) throw new RuntimeException('Escritura Softland prohibida en la prueba.');
        $d = $this->db->document;
        $params ??= [];
        if (str_contains($this->sql, 'AS montoBase')) {
            $valid = (int)$params[0] === 100 && $params[1] === 'C10';
            if (count($params) >= 4) $valid = $valid && $params[2] === $d['Fecha'];
            if (count($params) >= 5) $valid = $valid && $params[4] === $d['Tipo'];
            $this->rows = $valid ? [$d] : [];
        } elseif (str_contains($this->sql, 'AS ventaFolio')) {
            $this->rows = [['tipo' => $d['Tipo'], 'folio' => '100', 'fecha' => $d['Fecha'], 'codigoCompartido' => 'C10',
                'vendedorCompartido' => 'Origen', 'cliente' => $d['cliente'], 'ventaFolio' => $d['montoBase']]];
        } else {
            $this->rows = [['tipo' => $d['Tipo'], 'fecha' => $d['Fecha'], 'cliente' => $d['cliente'], 'codigoCompartido' => 'C10',
                'vendedorCompartido' => 'Origen', 'codigo' => 'PROD', 'producto' => 'Producto simulado', 'cantidad' => 1,
                'precio' => $d['montoBase'], 'total' => $d['montoBase'], 'orden' => 1]];
        }
        return true;
    }
    public function fetchAll(int $mode = PDO::FETCH_DEFAULT, mixed ...$args): array { return $this->rows; }
}
final class SharedTestSoftland extends PDO
{
    public function __construct(private Database $db) {}
    public function prepare(string $query, array $options = []): PDOStatement|false { return new SharedTestStatement($this->db, $query); }
}
final class Database
{
    public array $assignments = [], $notifications = [], $queries = [];
    public array $document = ['Folio' => 100, 'Fecha' => '2026-10-01', 'Tipo' => 'F', 'CodVendedor' => 'C10', 'cliente' => 'Cliente real del folio', 'montoBase' => 1000000.0];
    private SharedTestTransaction $transaction;
    public function __construct() { $this->transaction = new SharedTestTransaction($this); }
    public function mysql(): SharedTestTransaction { return $this->transaction; }
    public function softland(): PDO { return new SharedTestSoftland($this); }
    public function fetchAll(string $sql, array $params = []): array
    {
        $this->queries[] = $sql;
        if (str_contains($sql, 'SELECT u.id FROM usuario u')) return [['id' => 10]];
        if (str_contains($sql, 'SELECT cod_vendedor, tipo')) return $params[0] === 10 ? [['cod_vendedor' => 'C10', 'tipo' => 'C']] : [];
        if (str_contains($sql, 'MIN(TRIM(uv.cod_vendedor))')) return [['usuarioId' => 10, 'vendedor' => 'Origen', 'codigoPrincipal' => 'P10']];
        if (str_contains($sql, "= 'C'")) return [['usuarioId' => 10, 'codigo' => 'C10', 'vendedor' => 'Origen']];
        if (str_contains($sql, 'WHERE uv.tipo <>')) return [
            ['usuario_id' => 20, 'nombre' => 'Patricia', 'cod_vendedor' => 'P20'],
            ['usuario_id' => 30, 'nombre' => 'Juan', 'cod_vendedor' => 'P30'],
        ];
        if (str_contains($sql, 'FROM factura_compartida')) {
            $rows = array_values(array_filter($this->assignments, static fn(array $row): bool => $row['rol'] === 'compartido'));
            if (str_contains($sql, 'SELECT id, porcentaje')) return array_values(array_filter($rows, static fn(array $r): bool =>
                $r['folio'] === $params[0] && $r['cod_vendedor_principal'] === $params[1] && $r['mes'] === $params[2] && $r['anio'] === $params[3] && (!isset($params[4]) || $r['id'] !== $params[4])));
            return array_map(static fn(array $r): array => $r + ['codigoCompartido' => $r['cod_vendedor_principal'],
                'codigoAsignado' => $r['cod_vendedor_compartido'], 'vendedorAsignado' => $r['nombre_vendedor_compartido'],
                'codigo' => $r['cod_vendedor_compartido'], 'vendedor' => $r['nombre_vendedor_compartido'], 'monto' => $r['monto_asignado']], $rows);
        }
        throw new RuntimeException('Consulta no simulada: ' . $sql);
    }
    public function fetchOne(string $sql, array $params = []): ?array
    {
        if (str_contains($sql, 'FROM factura_compartida')) {
            $row = $this->assignments[$params[0]] ?? null;
            return $row && $row['rol'] === 'compartido' && (count($params) === 1 || in_array($row['cod_vendedor_principal'], array_slice($params, 1), true)) ? $row : null;
        }
        if (str_contains($sql, 'SELECT usuario_id')) return ['usuario_id' => $params[0] === 'P20' ? 20 : 30];
        throw new RuntimeException('Consulta individual no simulada.');
    }
    public function execute(string $sql, array $params = []): int
    {
        if (!$this->transaction->active) throw new RuntimeException('Escritura sin transacción.');
        if (str_starts_with($sql, 'INSERT INTO factura_compartida')) {
            $id = count($this->assignments) + 1;
            $this->assignments[$id] = array_combine(['folio','anio','mes','fecha','cliente','monto_neto','monto_asignado','porcentaje','cod_vendedor_principal','cod_vendedor_compartido','nombre_vendedor_compartido','usuario_id'], $params) + ['id' => $id, 'rol' => 'compartido'];
        } elseif (str_starts_with($sql, 'UPDATE factura_compartida')) {
            $id = $params[5];
            foreach (['cod_vendedor_compartido','nombre_vendedor_compartido','porcentaje','monto_neto','monto_asignado'] as $i => $key) $this->assignments[$id][$key] = $params[$i];
        } elseif (str_contains($sql, 'INSERT INTO notificaciones')) $this->notifications[] = $params;
        else throw new RuntimeException('Escritura fuera del alcance de la prueba.');
        return 1;
    }
}

$checks = 0;
function check(bool $ok, string $message): void { global $checks; if (!$ok) throw new RuntimeException('FALLO: ' . $message); $checks++; }
function rejects(callable $call, int $code): void {
    try { $call(); } catch (RuntimeException $e) { check($e->getCode() === $code, 'rechazo ' . $code . ': ' . $e->getMessage()); return; }
    throw new RuntimeException('Se esperaba rechazo ' . $code);
}
$payload = ['sub' => 99, 'nombre' => 'Gestor', 'area' => 'VENTAS', 'menus' => [['codigo' => 'rrhh_control_ventas_compartidas']]];
$admin = ['sub' => 88, 'is_admin' => true];
$body = ['tipo' => 'F', 'folio' => '100', 'fecha' => '2026-10-01', 'codigo_origen' => 'C10', 'cod_vendedor_compartido' => 'P20', 'porcentaje' => 30,
    'montoAsignado' => 999999999, 'monto_neto' => 1, 'cliente' => 'Inventado', 'usuario_id' => 10];
$filters = ['desde' => '2026-10-01', 'hasta' => '2026-10-31'];
$db = new Database(); $rrhh = new RrhhService($db);
$get = fn() => $rrhh->route($payload, 'GET', '/ventas-compartidas', $filters, []);
$create = fn(array $data) => $rrhh->route($payload, 'POST', '/ventas-compartidas/asignar', [], $data);
$put = fn(array $data) => $rrhh->route($admin, 'PUT', '/ventas-compartidas/asignaciones/1', [], $data);
check($get()['items'][0]['porcentajeRestante'] === 100.0 && $get()['items'][0]['montoRestanteOriginal'] === 1000000.0, 'sin asignaciones');
$create($body);
check($db->assignments[1]['monto_asignado'] === 300000 && $db->assignments[1]['monto_neto'] === 1000000.0, 'monto real, no monto del cliente');
check($db->assignments[1]['usuario_id'] === 99 && $db->assignments[1]['cliente'] === 'Cliente real del folio', 'actor RRHH y cliente Softland');
check(count($db->assignments) === 1 && $get()['items'][0]['montoRestanteOriginal'] === 700000.0, '30%, resto 70%, sin fila original');
check($get()['items'][0]['porcentajeRestante'] === 70.0, 'porcentaje restante 70');
check(count($db->notifications) === 2 && $db->notifications[1][0] === 20 && str_contains($db->notifications[1][3], 'administrativa'), 'notificación al receptor sin suplantar al origen');
$create(array_replace($body, ['porcentaje' => 20, 'cod_vendedor_compartido' => 'P30']));
check($get()['items'][0]['porcentajeRestante'] === 50.0 && $get()['items'][0]['montoRestanteOriginal'] === 500000.0, '30+20, resto 50');
$detail = $rrhh->route($payload, 'GET', '/ventas-compartidas/detalle', ['tipo' => 'F', 'folio' => '100', 'fecha' => '2026-10-01', 'codigo' => 'C10'], []);
check($detail['asignaciones'][0]['id'] === 1 && count($detail['receptores']) === 2 && $detail['resumen']['porcentajeRestante'] === 50.0, 'detalle editable y catálogo de Ventas');
$db->assignments[1]['usuario_id'] = 12;
$put(array_replace($body, ['porcentaje' => 40]));
check($db->assignments[1]['usuario_id'] === 12 && $db->assignments[1]['monto_asignado'] === 400000, 'edición preserva creador y excluye su ID');
check($get()['items'][0]['porcentajeRestante'] === 40.0, '40+20, resto 40');
$put(array_replace($body, ['porcentaje' => 40, 'cod_vendedor_compartido' => 'P30']));
check($db->assignments[1]['cod_vendedor_compartido'] === 'P30' && $db->assignments[1]['monto_asignado'] === 400000, 'cambio de receptor');
$rrhh->route($payload, 'PUT', '/ventas-compartidas/asignaciones/1', [], array_replace($body, ['porcentaje' => 40]));
check($db->assignments[1]['monto_asignado'] === 400000 && $db->assignments[1]['usuario_id'] === 12, 'modificación por menú sin área RRHH ni admin');
$before = $db->assignments; $notices = count($db->notifications);
rejects(fn() => $put(array_replace($body, ['porcentaje' => 90])), 400);
check($db->assignments === $before && count($db->notifications) === $notices && !$db->mysql()->inTransaction(), 'rollback al superar 100');
$db->assignments = [1 => array_replace($db->assignments[1], ['porcentaje' => 80, 'monto_asignado' => 800000])];
rejects(fn() => $create($body), 400);
check(count($db->assignments) === 1, '80+30 rechazado');
foreach ([['GET','/ventas-compartidas'], ['GET','/ventas-compartidas/detalle'], ['POST','/ventas-compartidas/asignar'], ['PUT','/ventas-compartidas/asignaciones/1']] as [$method,$path]) {
    rejects(fn() => $rrhh->route(['sub' => 98, 'area' => 'RRHH'], $method, $path, $filters, $body), 403);
}
check($rrhh->route($admin, 'GET', '/ventas-compartidas', $filters, [])['ok'], 'admin permitido');
check($rrhh->route(['sub' => 99, 'menus_directos' => $payload['menus']], 'GET', '/ventas-compartidas', $filters, [])['ok'], 'menú directo permitido');
rejects(fn() => $rrhh->route($payload, 'GET', '/confirmaciones', [], []), 403);
rejects(fn() => $create(array_replace($body, ['cod_vendedor_compartido' => 'INVALIDO'])), 400);
rejects(fn() => $create(array_replace($body, ['fecha' => '2026-10-02'])), 404);
rejects(fn() => $create(array_replace($body, ['tipo' => 'N'])), 404);
rejects(fn() => $create(array_replace($body, ['codigo_origen' => 'OTRO'])), 400);
rejects(fn() => $rrhh->route($admin, 'PUT', '/ventas-compartidas/asignaciones/99', [], $body), 404);
$db->assignments[1]['rol'] = 'principal'; rejects(fn() => $put($body), 404);
rejects(fn() => $rrhh->route($admin, 'DELETE', '/ventas-compartidas/asignaciones/1', [], []), 404);
check(count(array_filter($db->queries, fn(string $q): bool => str_contains($q, 'FOR UPDATE'))) > 0, 'bloqueos comunes a lectura y escritura');

$salesDb = new Database(); $hrDb = new Database();
$sales = new DashboardService($salesDb); $hr = new RrhhService($hrDb);
$sales->route(['sub' => 10, 'nombre' => 'Origen'], 'POST', '/compartir', [], $body);
$hr->route($admin, 'POST', '/ventas-compartidas/asignar', [], $body);
foreach (['monto_neto','monto_asignado','porcentaje','cod_vendedor_principal','cod_vendedor_compartido','mes','anio','fecha','cliente','rol'] as $field) check($salesDb->assignments[1][$field] === $hrDb->assignments[1][$field], 'equivalencia Ventas/RRHH: ' . $field);
$sales->route(['sub' => 10], 'PUT', '/compartir/1', [], array_replace($body, ['porcentaje' => 40]));
$hr->route($admin, 'PUT', '/ventas-compartidas/asignaciones/1', [], array_replace($body, ['porcentaje' => 40]));
check($salesDb->assignments[1]['monto_asignado'] === $hrDb->assignments[1]['monto_asignado'], 'equivalencia de actualización');
rejects(fn() => $sales->route($payload, 'POST', '/compartir', [], $body), 403);
foreach ([-1000000.0, -5.0] as $amount) {
    $creditDb = new Database(); $creditDb->document['Tipo'] = 'N'; $creditDb->document['montoBase'] = $amount;
    (new RrhhService($creditDb))->route($admin, 'POST', '/ventas-compartidas/asignar', [], array_replace($body, ['tipo' => 'N']));
    check($creditDb->assignments[1]['monto_asignado'] === (int)round($amount * .3), 'nota de crédito conserva signo y redondeo');
}
echo "OK: $checks comprobaciones de gestión RRHH/Ventas con fakes, sin conexiones ni escrituras reales.\n";
