<?php
declare(strict_types=1);

// Reutiliza los fixtures históricos sin alterar su fallo preexistente ni conectar BD reales.
try { require __DIR__ . '/test_cobranza.php'; }
catch (RuntimeException $error) {
    if ($error->getMessage() !== 'Evolucion nuevos por RUT: [2,3]') throw $error;
    echo "Fixture cargado; inconsistencia preexistente de evolución permanece fuera de alcance.\n";
}
require_once dirname(__DIR__) . '/api/src/ClienteClasificacionOverrideService.php';

final class EffectiveMysqlPDO extends PDO
{
    public int $overrideReads = 0;
    public function __construct() { parent::__construct('sqlite::memory:'); $this->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION); }
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        if (str_contains($query, 'SELECT * FROM cliente_clasificacion_override')) $this->overrideReads++;
        return parent::prepare($query, $options);
    }
}
final class EffectiveDB extends Database
{
    public function __construct(PDO $softland, private PDO $mysql) { parent::__construct($softland, []); }
    public function mysql(): PDO { return $this->mysql; }
    public function fetchAll(string $sql, array $params = []): array
    {
        $stmt = $this->softland()->prepare($sql); $stmt->execute($params); return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
}
final class EffectiveSoftlandPDO extends PDO
{
    public function __construct(private PDO $fixture) {}
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        // Adaptación adicional necesaria para el detalle por propietario, sin tocar el test legado.
        $query = preg_replace('/TRY_CONVERT\(bigint,\s*([\w.]+)\)/i', 'CAST($1 AS INTEGER)', $query);
        return $this->fixture->prepare($query, $options);
    }
}
$mysql = new EffectiveMysqlPDO();
$mysql->exec('CREATE TABLE cliente_clasificacion_override (
    id INTEGER PRIMARY KEY AUTOINCREMENT, periodo TEXT, tipo_evento TEXT, accion TEXT, rut_normalizado TEXT,
    rut_original TEXT, codaux TEXT, tipo_documento TEXT, folio TEXT, nroint TEXT, fecha_documento TEXT,
    cliente_nombre TEXT, codigo_vendedor_origen TEXT, motivo_codigo TEXT, motivo_detalle TEXT, datos_validacion TEXT,
    creado_por INTEGER, creado_por_nombre TEXT, creado_en TEXT DEFAULT CURRENT_TIMESTAMP, activo INTEGER DEFAULT 1,
    revertido_por INTEGER, revertido_por_nombre TEXT, revertido_en TEXT, motivo_reversion TEXT)');
$effectiveDb = new EffectiveDB(new EffectiveSoftlandPDO($pool), $mysql);
$central = new ClienteClasificacionOverrideService($effectiveDb);
$effective = new CobranzaService($effectiveDb, new AnalyticsService($effectiveDb), $central);
$checksEffective = 0;
$equal = static function ($actual, $expected, string $name) use (&$checksEffective): void {
    $checksEffective++; if ($actual !== $expected) throw new RuntimeException($name . ': ' . json_encode([$actual, $expected]));
};
$reportMethod = new ReflectionMethod(CobranzaService::class, 'report');
$report = static fn(array $filters = []) => $reportMethod->invoke($effective, array_replace($base, $filters), false);
$legacy = $reportMethod->invoke($service, $base, false);
$mysql->overrideReads = 0;
$baseline = $report();
$equal($baseline, $legacy, 'Sin overrides conserva resultado automático exacto');
$equal($mysql->overrideReads, 1, 'Una consulta por rango, sin N+1');
$actorEffective = ['usuarioId'=>1,'nombre'=>'TEST EFECTIVO'];
$make = static function (string $type, string $action, string $rut, string $code, string $folio, string $date, float $amount = 241536.0) use ($central, $actorEffective): array {
    return $central->crear(['periodo'=>substr($date, 0, 7),'tipoEvento'=>$type,'accion'=>$action,'rut'=>$rut,
        'codaux'=>$code,'tipoDocumento'=>'F','folio'=>$folio,'nroint'=>$folio,'fechaDocumento'=>$date,
        'clienteNombre'=>'Cliente ' . $code,'codigoVendedorOrigen'=>'479','motivoCodigo'=>'TEST_EFECTIVO',
        'datosValidacion'=>['folio'=>$folio,'nroint'=>$folio,'fecha'=>$date,'rut'=>$rut,'codaux'=>$code,
            'monto'=>$amount,'vendedorOrigen'=>['codigo'=>'479','nombre'=>'Olga'],
            'compartidos'=>[['codigo'=>'652','nombre'=>'Rosangel','porcentaje'=>50]]]], $actorEffective);
};
$revert = static fn(array $row) => $central->revertir((int)$row['id'], $actorEffective, 'Fin de prueba');
$first = $make('RECUPERADO','EXCLUIR','99.999.999-9','R1','300','2026-09-13');
$excluded = $report();
$equal($excluded['recuperados'], [], 'Exclusión elimina evento completo compartido');
$equal($excluded['resumen']['clientesRecuperados'], $baseline['resumen']['clientesRecuperados'] - 1, 'Recuenta recuperados');
$equal((float)$excluded['resumen']['ventaRecuperados'], (float)$baseline['resumen']['ventaRecuperados'] - (float)$baseline['recuperados'][0]['ventaTotal'], 'Resta monto exacto');
$equal($report(['vendedorId'=>'1'])['recuperados'], [], 'Exclusión global para propietario');
$equal($report(['vendedorId'=>'2'])['recuperados'], [], 'Sin copia para compartidos');
$annual = $effective->route($payload, 'GET', '/control-clientes/evolucion', ['anio'=>'2026','tipo'=>'recuperados']);
$equal($annual['meses'][8]['cantidad'], 0, 'Evolución efectiva excluye');
$equal((float)$annual['meses'][8]['venta'], 0.0, 'Venta evolución efectiva excluye');
$detail = $effective->route($payload, 'GET', '/control-clientes/evolucion-detalle', ['anio'=>'2026','mes'=>'9','tipo'=>'recuperados','vendedorId'=>'1']);
$equal($detail['clientes'], [], 'Detalle evolución excluye');
$revert($first);
$equal($report(), $baseline, 'Reversión restaura resultado automático exacto');
$equal(count($central->listar(['activo'=>0])), 1, 'Historial permanece administrativo');
$newBase = array_values(array_filter($baseline['nuevos'], static fn($e) => $e['codigoCliente'] === 'N1'))[0];
$row = $make('NUEVO','EXCLUIR','76.123.456-k','N1','100','2026-09-05');
$out = $report();
$equal($out['resumen']['clientesNuevos'], $baseline['resumen']['clientesNuevos'] - 1, 'Excluye Nuevo');
$equal((float)$out['resumen']['ventaNuevos'], (float)$baseline['resumen']['ventaNuevos'] - (float)$newBase['ventaTotal'], 'Venta Nuevos efectiva');
$equal(count(array_filter($out['nuevos'], static fn($e) => in_array('N2', $e['codigos'], true))), 0, 'Exclusión por RUT abarca varios CodAux');
$revert($row);
$row = $make('RECUPERADO','INCLUIR','999999999','R1','300','2026-09-13');
$equal($report(), $baseline, 'Inclusión existente no duplica ni cambia importes');
$revert($row);
$row = $make('NUEVO','INCLUIR','14.156.064-6','B','2','2026-09-10',250000);
$out = $report();
$equal($out['resumen']['clientesNuevos'], $baseline['resumen']['clientesNuevos'] + 1, 'Incluye Nuevo omitido');
$manual = array_values(array_filter($out['nuevos'], static fn($e) => $e['codigoCliente'] === 'B'))[0];
$equal($manual['ventaTotal'], 250000.0, 'Monto desde evidencia');
$equal($manual['cantidadFolios'], 1, 'Solo folio validado');
$equal($manual['propietarios'], [], 'No confunde participantes con propietarios');
$equal($manual['concurso'], null, 'Capa manual no inventa puntos');
$equal($report(['desde'=>'2026-09-15'])['resumen']['clientesNuevos'], 0, 'No incluye referencia fuera de rango parcial');
$equal(count(array_filter($report(['rut'=>'999999999'])['nuevos'], static fn($e) => $e['codigoCliente'] === 'B')), 0, 'Inclusión respeta filtro RUT');
$revert($row);
$row = $make('RECUPERADO','INCLUIR','76123456K','N1','100','2026-09-05');
$out = $report();
$equal(count(array_filter($out['nuevos'], static fn($e) => $e['codigoCliente'] === 'N1')), 0, 'Inclusión Recuperado prevalece sobre Nuevo automático');
$manual = array_values(array_filter($out['recuperados'], static fn($e) => $e['codigoCliente'] === 'N1'))[0];
$equal($manual['diasInactividad'], null, 'No inventa días históricos');
$equal($manual['ultimaCompra'], null, 'No inventa última compra');
$annual = $effective->route($payload, 'GET', '/control-clientes/evolucion', ['anio'=>'2026','tipo'=>'recuperados']);
$equal($annual['meses'][8]['cantidad'], 2, 'Inclusión suma en evolución con propietario');
$equal((float)$annual['meses'][8]['venta'], 483072.0, 'Venta evolución desde conjunto efectivo');
$detail = $effective->route($payload, 'GET', '/control-clientes/evolucion-detalle', ['anio'=>'2026','mes'=>'9','tipo'=>'recuperados','vendedorId'=>'1']);
$equal($detail['cantidad'], 2, 'Detalle evolución incluye');
$equal($detail['monto'], 483072.0, 'Detalle y gráfico concilian');
$revert($row);
$row = $make('NUEVO','INCLUIR','999999999','R1','300','2026-09-13');
$out = $report();
$equal($out['recuperados'], [], 'Inclusión Nuevo prevalece sobre Recuperado automático');
$equal(count(array_filter($out['nuevos'], static fn($e) => $e['codigoCliente'] === 'R1')), 1, 'Un solo evento efectivo forzado');
$revert($row);
$otherMonth = $make('RECUPERADO','EXCLUIR','95441390K','CAR','400','2026-10-13');
$equal($report(), $baseline, 'Override de otro mes no afecta septiembre');
$september = $make('RECUPERADO','EXCLUIR','999999999','R1','300','2026-09-13');
$mysql->overrideReads = 0;
$range = $report(['desde'=>'2026-09-01','hasta'=>'2026-10-31']);
$equal($range['recuperados'], [], 'Rango aplica exclusiones de ambos meses');
$equal($mysql->overrideReads, 1, 'Rango de dos meses usa una consulta');
$revert($otherMonth); $revert($september);

// Dos eventos automáticos por CodAux del mismo RUT: exclusión global e inclusión sin duplicados.
$apply = new ReflectionMethod(CobranzaService::class, 'aplicarOverridesClasificacion');
$a = $baseline['recuperados'][0]; $b = $a;
$b['codigoCliente'] = 'OTRO_CODIGO'; $b['folios'][0]['clienteCodigo'] = 'OTRO_CODIGO'; $b['folios'][0]['NroInt'] = 987;
$filters = ['desde'=>'2026-09-01','hasta'=>'2026-09-30','identidad'=>null];
$row = $make('RECUPERADO','EXCLUIR','999999999','R1','300','2026-09-13');
$equal($apply->invoke($effective, [], [$a,$b], $filters)[1], [], 'Exclusión elimina todos los CodAux de un RUT');
$revert($row);
$row = $make('RECUPERADO','INCLUIR','999999999','R1','300','2026-09-13');
$merged = array_values($apply->invoke($effective, [], [$a,$b], $filters)[1]);
$equal(count($merged), 1, 'Inclusión consolida evento existente por RUT');
$equal($merged[0]['cantidadFolios'], 2, 'Conserva ambos documentos originales');
$revert($row);
$equal($report(), $baseline, 'Todas las reversiones mantienen motor intacto');
echo "OK clasificación efectiva Cobranzas: $checksEffective validaciones; solo SQLite en memoria.\n";
