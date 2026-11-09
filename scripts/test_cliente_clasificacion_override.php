<?php
declare(strict_types=1);

// Aislado: no carga bootstrap ni .env; Database solo puede devolver SQLite en memoria.
final class Database
{
    public function __construct(private PDO $pdo) {}
    public function mysql(): PDO { return $this->pdo; }
}
require_once dirname(__DIR__) . '/api/src/ClienteClasificacionOverrideService.php';

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec("CREATE TABLE cliente_clasificacion_override (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    periodo CHAR(7) NOT NULL, tipo_evento VARCHAR(20) NOT NULL, accion VARCHAR(20) NOT NULL,
    rut_normalizado VARCHAR(20) NOT NULL, rut_original VARCHAR(20), codaux VARCHAR(30),
    tipo_documento VARCHAR(5), folio VARCHAR(30), nroint VARCHAR(30), fecha_documento DATE,
    cliente_nombre VARCHAR(255), codigo_vendedor_origen VARCHAR(30), motivo_codigo VARCHAR(80) NOT NULL,
    motivo_detalle VARCHAR(1000), datos_validacion TEXT, creado_por BIGINT, creado_por_nombre VARCHAR(255),
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, activo INTEGER NOT NULL DEFAULT 1,
    revertido_por BIGINT, revertido_por_nombre VARCHAR(255), revertido_en DATETIME, motivo_reversion VARCHAR(1000),
    CHECK (tipo_evento IN ('NUEVO','RECUPERADO')), CHECK (accion IN ('INCLUIR','EXCLUIR')), CHECK (activo IN (0,1))
)");
$service = new ClienteClasificacionOverrideService(new Database($pdo));
$checks = 0;
$expect = static function (mixed $actual, mixed $expected, string $name) use (&$checks): void {
    $checks++;
    if ($actual !== $expected) throw new RuntimeException($name . ': ' . json_encode([$actual, $expected]));
};
$error = static function (callable $operation, int $code, ?string $message = null) use ($expect): void {
    try { $operation(); } catch (RuntimeException $failure) {
        $expect($failure->getCode(), $code, 'Código del error');
        if ($message !== null) $expect($failure->getMessage(), $message, 'Mensaje del error');
        return;
    }
    throw new LogicException('Se esperaba error ' . $code);
};
$actor = ['usuarioId' => 11, 'nombre' => 'ADMIN TEST'];
$revisor = ['usuarioId' => 12, 'nombre' => 'REVISOR TEST'];
$event = ['periodo' => '2026-10', 'tipoEvento' => 'RECUPERADO', 'accion' => 'EXCLUIR',
    'rut' => '84.807.200-1', 'codaux' => '84807201', 'folio' => '380985', 'tipoDocumento' => 'F',
    'clienteNombre' => 'BRUNO FRITSCH SA', 'motivo_codigo' => 'PRUEBA_AISLADA',
    'fechaDocumento' => '2026-10-06', 'datosValidacion' => ['fuente' => 'fixture']];
$neutral = ['override' => null, 'accion' => null, 'forzarInclusion' => false, 'forzarExclusion' => false];
$resolve = static fn() => $service->resolver('2026-10', 'RECUPERADO', '848072001');
$expect($resolve(), $neutral, 'Sin override');
$row = $service->crear($event + ['creado_por' => 999, 'activo' => 0], $actor);
$id = (int)$row['id'];
$expect($row['rut_normalizado'], '848072001', 'RUT normalizado');
$expect($row['rut_original'], '84.807.200-1', 'RUT original');
$expect($row['folio'], '380985', 'Folio de referencia');
$expect($row['fecha_documento'], '2026-10-06', 'Fecha de referencia');
$expect(json_decode($row['datos_validacion'], true), ['fuente' => 'fixture'], 'Evidencia JSON');
$expect((int)$row['creado_por'], 11, 'Actor explícito prevalece sobre payload');
$expect($row['creado_por_nombre'], 'ADMIN TEST', 'Nombre del actor');
$expect(is_string($row['creado_en']) && $row['creado_en'] !== '', true, 'Fecha de creación');
$expect((int)$row['activo'], 1, 'Siempre creado activo');
$expect($resolve()['forzarExclusion'], true, 'Resolver exclusión');
$expect($resolve()['forzarInclusion'], false, 'Exclusión sin inclusión');
$error(fn() => $service->crear($event, $actor), 409, 'Ya existe un override activo equivalente.');
$include = array_replace($event, ['accion' => 'INCLUIR']);
$error(fn() => $service->crear($include, $actor), 409, 'Existe un override activo contrario. Debe revertirlo antes de crear uno nuevo.');
$expect(count($service->listar()), 1, 'Conflictos no insertan');
$expect($pdo->inTransaction(), false, 'Conflictos cierran transacción');
$reverted = $service->revertir($id, $revisor, 'Corrección de prueba');
$expect((int)$reverted['activo'], 0, 'Reversión inactiva');
$expect((int)$reverted['revertido_por'], 12, 'Actor de reversión');
$expect($reverted['revertido_por_nombre'], 'REVISOR TEST', 'Nombre de reversión');
$expect($reverted['motivo_reversion'], 'Corrección de prueba', 'Motivo de reversión');
$expect(is_string($reverted['revertido_en']) && $reverted['revertido_en'] !== '', true, 'Fecha de reversión');
$expect($resolve(), $neutral, 'Neutral después de revertir');
$expect(count($service->listar(['activo' => 0])), 1, 'Historial conservado');
$error(fn() => $service->revertir($id, $actor, 'Otra vez'), 409);
$error(fn() => $service->revertir(999999, $actor, 'No existe'), 404);
$row = $service->crear($include, $actor);
$expect($resolve()['forzarInclusion'], true, 'Inclusión después de revertir');
$expect($resolve()['forzarExclusion'], false, 'Inclusión sin exclusión');
$otherInclude = array_replace($include, ['tipoEvento' => 'NUEVO']);
$error(fn() => $service->crear($otherInclude, $actor), 409,
    'El cliente ya posee una inclusión manual activa como RECUPERADO para este período.');
$service->revertir((int)$row['id'], $actor, 'Cambio de prueba');
$newRow = $service->crear($otherInclude, $actor);
$error(fn() => $service->crear($include, $actor), 409,
    'El cliente ya posee una inclusión manual activa como NUEVO para este período.');
$service->revertir((int)$newRow['id'], $actor, 'Finalizar inclusión de prueba');
$exclusion = $service->crear($event, $actor);
$otherExclusion = $service->crear(array_replace($event, ['tipoEvento' => 'NUEVO']), $actor);
$expect(count($service->listar(['activo' => 1])), 2, 'Dos exclusiones de tipos distintos permitidas');
foreach (['84.807.200-1', '84807200-1', '848072001'] as $rut) {
    $expect((int)$service->buscarVigente('2026-10', 'RECUPERADO', $rut)['id'], (int)$exclusion['id'], 'Identidad global por RUT');
}
$expect($service->resolver('2026-11', 'RECUPERADO', '848072001'), $neutral, 'Períodos independientes');
$expect($service->resolver('2026-10', 'RECUPERADO', '111111111'), $neutral, 'RUT independiente');
foreach (['2026-00', '2026-13', '2026-1', '26-10', '', '2026-10-01', '0000-10'] as $periodo) {
    $error(fn() => $service->crear(array_replace($event, ['periodo' => $periodo]), $actor), 400);
}
foreach (['tipoEvento' => 'OTRO', 'accion' => 'BORRAR', 'motivo_codigo' => ' ', 'rut' => '',
    'fechaDocumento' => '2026-02-30', 'datosValidacion' => '{invalid', 'rutNormalizado' => '111111111',
    'folio' => str_repeat('1', 31)] as $field => $value) {
    $error(fn() => $service->crear(array_replace($event, [$field => $value]), $actor), 400);
}
$error(fn() => $service->crear($event, ['usuarioId' => 0, 'nombre' => 'TEST']), 400);
$error(fn() => $service->crear($event, ['usuarioId' => 1, 'nombre' => ' ']), 400);
$error(fn() => $service->revertir((int)$exclusion['id'], $actor, ' '), 400);
$error(fn() => $service->listar(['activo' => 2]), 400);
$error(fn() => $service->listar(['campo_arbitrario' => 'x']), 400);
$expect(count($service->listar(['folio' => '380985', 'tipoEvento' => 'RECUPERADO'])), 3, 'Listado incluye historial y evidencia');

// Un fallo posterior al INSERT revierte toda la operación, sin dejar filas ni transacción abierta.
$pdo->exec("CREATE TRIGGER fallo_insert AFTER INSERT ON cliente_clasificacion_override
    WHEN NEW.periodo = '2026-12' BEGIN SELECT RAISE(ABORT, 'Fallo simulado'); END");
$before = count($service->listar());
try {
    $service->crear(array_replace($event, ['periodo' => '2026-12']), $actor);
    throw new LogicException('Se esperaba fallo de persistencia');
} catch (PDOException $failure) {
    $expect(str_contains($failure->getMessage(), 'Fallo simulado'), true, 'Fallo de persistencia propagado');
}
$expect(count($service->listar()), $before, 'Rollback por fallo de persistencia');
$expect($pdo->inTransaction(), false, 'Rollback cierra transacción');

// El servicio no confirma ni revierte una transacción ajena.
$pdo->beginTransaction();
$error(fn() => $service->crear(array_replace($event, ['periodo' => '2026-11']), $actor), 409);
$expect($pdo->inTransaction(), true, 'Transacción del llamador preservada');
$pdo->rollBack();
$service->revertir((int)$exclusion['id'], $actor, 'Finalizar prueba');
$service->revertir((int)$otherExclusion['id'], $actor, 'Finalizar prueba');
$expect($service->listar(['activo' => 1]), [], 'Sin overrides activos al finalizar');
$expect(count($service->listar()), 5, 'Sin borrado físico del historial');

// Rama MySQL con un PDO controlado: verifica orden de bloqueo/transacción sin MySQL real.
final class OverrideMysqlPDO extends PDO
{
    public array $events = [];
    public bool $denyLock = false;
    public function __construct(string $schema)
    {
        parent::__construct('sqlite::memory:');
        $this->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->exec($schema);
        $this->sqliteCreateFunction('test_get_lock', function (string $key): int {
            $this->events[] = ['acquire', $key];
            return $this->denyLock ? 0 : 1;
        });
        $this->sqliteCreateFunction('test_release_lock', function (string $key): int {
            $this->events[] = ['release', $key];
            return 1;
        });
    }
    public function getAttribute(int $attribute): mixed
    {
        return $attribute === PDO::ATTR_DRIVER_NAME ? 'mysql' : parent::getAttribute($attribute);
    }
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $query = str_replace(['GET_LOCK(?, 10)', 'RELEASE_LOCK(?)', ' FOR UPDATE'],
            ['test_get_lock(?)', 'test_release_lock(?)', ''], $query);
        return parent::prepare($query, $options);
    }
    public function beginTransaction(): bool { $this->events[] = ['begin']; return parent::beginTransaction(); }
    public function commit(): bool { $this->events[] = ['commit']; return parent::commit(); }
    public function rollBack(): bool { $this->events[] = ['rollback']; return parent::rollBack(); }
}
$mysqlDouble = new OverrideMysqlPDO($pdo->query("SELECT sql FROM sqlite_master WHERE name = 'cliente_clasificacion_override'")->fetchColumn());
$mysqlService = new ClienteClasificacionOverrideService(new Database($mysqlDouble));
$mysqlRow = $mysqlService->crear($include, $actor);
$expect(array_column($mysqlDouble->events, 0), ['acquire', 'begin', 'commit', 'release'], 'Bloqueo cubre hasta el commit');
$key = $mysqlDouble->events[0][1];
$expect($mysqlDouble->events[3][1], $key, 'Libera el mismo bloqueo');
$expect(strlen($key) <= 64, true, 'Nombre compatible con GET_LOCK');
$mysqlDouble->events = [];
$error(fn() => $mysqlService->crear($otherInclude, $actor), 409);
$expect(array_column($mysqlDouble->events, 0), ['acquire', 'begin', 'rollback', 'release'], 'Conflicto revierte y libera bloqueo');
$expect($mysqlDouble->events[0][1], $key, 'Mismo bloqueo para NUEVO y RECUPERADO');
$mysqlDouble->events = [];
$mysqlService->revertir((int)$mysqlRow['id'], $revisor, 'Finalizar prueba controlada');
$expect(array_column($mysqlDouble->events, 0), ['acquire', 'begin', 'commit', 'release'], 'Reversión serializada');
$expect($mysqlDouble->events[0][1], $key, 'Reversión bloquea el mismo evento');
$mysqlDouble->events = [];
$mysqlDouble->denyLock = true;
$error(fn() => $mysqlService->crear($event, $actor), 409);
$expect(array_column($mysqlDouble->events, 0), ['acquire'], 'Sin bloqueo no inicia operación');
$expect($mysqlService->listar(['activo' => 1]), [], 'Sin inserción al fallar bloqueo');
echo "OK cliente clasificacion override: $checks validaciones; SQLite en memoria, sin conexiones reales.\n";
