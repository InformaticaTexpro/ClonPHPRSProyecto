<?php
declare(strict_types=1);

require __DIR__ . '/test_concurso_ventas.php';
require_once dirname(__DIR__) . '/api/src/ClienteClasificacionOverrideService.php';

final class CarteraOverrideMysqlPDO extends PDO
{
    public int $reads = 0;
    public function __construct() { parent::__construct('sqlite::memory:'); $this->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION); }
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        if (str_contains($query, 'SELECT * FROM cliente_clasificacion_override')) $this->reads++;
        return parent::prepare($query, $options);
    }
}
final class CarteraOverrideDB extends Database
{
    public function __construct(PDO $softland, private PDO $mysql, private array $codes = ['479']) { parent::__construct($softland, []); }
    public function mysql(): PDO { return $this->mysql; }
    public function fetchOne(string $sql, array $params = []): array
    {
        if (str_contains($sql, 'SELECT area FROM usuario')) return ['area'=>'PRODUCTOS_QUIMICOS'];
        return parent::fetchOne($sql,$params);
    }
    public function fetchAll(string $sql, array $params = []): array
    {
        if (str_contains($sql, 'usuario_vendedor')) return array_map(static fn($code) => ['cod_vendedor'=>$code,'tipo'=>'P'], $this->codes);
        throw new RuntimeException('Consulta inesperada en test aislado');
    }
}
$mysql = new CarteraOverrideMysqlPDO();
$mysql->exec('CREATE TABLE cliente_clasificacion_override (
    id INTEGER PRIMARY KEY AUTOINCREMENT, periodo TEXT, tipo_evento TEXT, accion TEXT, rut_normalizado TEXT,
    rut_original TEXT, codaux TEXT, tipo_documento TEXT, folio TEXT, nroint TEXT, fecha_documento TEXT,
    cliente_nombre TEXT, codigo_vendedor_origen TEXT, motivo_codigo TEXT, motivo_detalle TEXT, datos_validacion TEXT,
    creado_por INTEGER, creado_por_nombre TEXT, creado_en TEXT DEFAULT CURRENT_TIMESTAMP, activo INTEGER DEFAULT 1,
    revertido_por INTEGER, revertido_por_nombre TEXT, revertido_en TEXT, motivo_reversion TEXT)');
$central = new ClienteClasificacionOverrideService(new CarteraOverrideDB(new ConcursoClientPDO([]), $mysql));
$actor = ['usuarioId'=>1,'nombre'=>'TEST AISLADO'];
$payload = ['sub'=>1,'area'=>'PRODUCTOS_QUIMICOS'];
$query = ['anio'=>'2026','mes'=>'10'];
$checksCartera = 0;
$eq = static function ($actual, $expected, string $label) use (&$checksCartera): void {
    $checksCartera++; if ($actual !== $expected) throw new RuntimeException($label . ': ' . json_encode([$actual,$expected]));
};
$fixture = static function (bool $automaticRecovered = true, bool $alias = false): array {
    $row = static fn($code,$first,$previous) => ['CodAux'=>$code,'NomAux'=>'Cliente '.$code,'FechaPrimera'=>$first,
        'FechaUltima'=>'2026-10-05','FechaMinMesActual'=>'2026-10-05','FechaUltimaPrevia'=>$previous,
        'FechaUltimaVendedor'=>'2026-10-05','EsActivo'=>1,'TieneMesActual'=>1];
    $total = [$row('R1','2024-01-01','2026-01-12'),$row('N1','2026-10-05',null),$row('OMITIDO','2024-01-01','2026-09-01')];
    $recovered = ['CodAux'=>'R1','CodCliente'=>'R1','CodVendedor'=>'479','Folio'=>'380985','NroInt'=>'123',
        'FechaCompra'=>'2026-10-05','FechaCompraAnterior'=>'2026-01-12','DiasSinComprar'=>266,'NomAux'=>'Cliente R1'];
    $recs = $automaticRecovered ? [$recovered] : [];
    if ($alias) { $total[]=$row('R2','2024-01-01','2026-01-12'); $recs[]=array_replace($recovered,['CodAux'=>'R2','CodCliente'=>'R2']); }
    return [array_map(static fn($r)=>['CodAux'=>$r['CodAux']],$total),$total,$recs,
        [['CodAux'=>'R1','RutAux'=>'84.807.200-1'],['CodAux'=>'R2','RutAux'=>'848072001'],['CodAux'=>'N1','RutAux'=>'76.123.456-K']],
        [['CodAux'=>'OMITIDO'],['CodAux'=>'R1']]];
};
$run = static function (bool $enabled = true, bool $recovered = true, bool $alias = false, array $codes = ['479'], bool $forUser = false) use ($fixture,$mysql,$central,$payload,$query): array {
    $batches = $fixture($recovered,$alias);
    if ($codes === ['652']) {
        $batches[0] = [['CodAux'=>'N1']]; $batches[1] = [$batches[1][1]];
        $batches[2] = []; $batches[4] = [];
    }
    $pdo = new ConcursoClientPDO($batches);
    $analytics = new AnalyticsService(new CarteraOverrideDB($pdo,$mysql,$codes), $enabled ? $central : null);
    return $forUser ? $analytics->carteraForUser(1,$query) : $analytics->cartera($payload,$query);
};
$make = static function (string $type,string $action,string $rut,string $code = 'R1',string $period = '2026-10') use ($central,$actor): array {
    return $central->crear(['periodo'=>$period,'tipoEvento'=>$type,'accion'=>$action,'rut'=>$rut,'codaux'=>$code,
        'tipoDocumento'=>'F','folio'=>'380985','nroint'=>'123','fechaDocumento'=>$period.'-05',
        'clienteNombre'=>'Cliente '.$code,'codigoVendedorOrigen'=>'479','motivoCodigo'=>'PRUEBA_AISLADA',
        'motivoDetalle'=>'NO EXPONER A VENDEDOR','datosValidacion'=>['folio'=>'380985','nroint'=>'123','fecha'=>$period.'-05',
            'rut'=>$rut,'codaux'=>$code,'monto'=>324017,'vendedorOrigen'=>['codigo'=>'479','nombre'=>'Vendedor real validado'],
            'compartidos'=>[['codigo'=>'652','nombre'=>'Compartido','porcentaje'=>50]]]],$actor);
};
$revert = static fn(array $r) => $central->revertir((int)$r['id'],$actor,'Fin de prueba aislada');
$automatic = $run(false);
$mysql->reads=0;
$eq($run(),$automatic,'Sin overrides resultado exacto');
$eq($mysql->reads,1,'Una consulta de overrides por período');
$eq($run(forUser:true),$automatic,'Ambos caminos sin override son idénticos');
$row=$make('RECUPERADO','EXCLUIR','84.807.200-1');
$mysql->reads=0;
$excluded=$run();
$eq($excluded['recuperados'],[],'Desaparece de detalle recuperados');
$eq($excluded['ClientesRecuperados'],$automatic['ClientesRecuperados']-1,'KPI recuperados disminuye uno');
$eq($mysql->reads,1,'Sin consulta por cliente');
$mysql->reads=0;
$eq($run(forUser:true),$excluded,'carteraForUser excluye exactamente igual que cartera');
$eq($mysql->reads,1,'carteraForUser carga overrides una vez por período');
foreach (['TotalClientes','ClientesActivos','ClientesInactivos','ClientesActivosMesActual','total','activos','inactivos','activosMesActual'] as $key) $eq($excluded[$key],$automatic[$key],'Métrica ajena intacta: '.$key);
$eq($run(true,true,true)['recuperados'],[],'EXCLUIR por RUT elimina varios CodAux');
$eq(str_contains(json_encode($excluded),'PRUEBA_AISLADA'),false,'No expone motivo');
$eq(str_contains(json_encode($excluded),'NO EXPONER'),false,'No expone observaciones');
$revert($row);
$eq($run(),$automatic,'Revertido devuelve cliente automático');
$eq($run(forUser:true),$automatic,'Reversión restaura ambos caminos');
$row=$make('NUEVO','EXCLUIR','76.123.456-k','N1');
$eq($run()['nuevos'],[],'Excluye Nuevo');
$eq($run()['ClientesNuevos'],0,'KPI Nuevos efectivo');
$eq($run(forUser:true),$run(),'NUEVO EXCLUIR idéntico en ambos caminos');
$revert($row);
$row=$make('RECUPERADO','INCLUIR','848072001');
$manual=$run(true,false);
$eq($manual['ClientesRecuperados'],1,'Incluye Recuperado omitido');
$eq($manual['recuperados'][0]['Folio'],'380985','Folio validado');
$eq($manual['recuperados'][0]['FechaCompra'],'2026-10-05','Fecha validada');
$eq($run(true,false,forUser:true),$manual,'RECUPERADO INCLUIR idéntico en ambos caminos');
$eq($run(),$automatic,'INCLUIR existente no duplica ni altera');
$eq($run(true,true,true)['ClientesRecuperados'],1,'Incluye varios CodAux como único evento');
$foreign=$run(true,false,false,['652']);
$eq($foreign['recuperados'],[],'Compartido no recibe inclusión ajena del origen');
$json=json_encode($manual);
foreach (['motivo_codigo','motivo_detalle','creado_por','datos_validacion','revertido_en','NO EXPONER'] as $secret) $eq(str_contains($json,$secret),false,'Privacidad: '.$secret);
$revert($row);
$row=$make('NUEVO','INCLUIR','848072001','OMITIDO');
$includedNew=$run();
$eq($includedNew['ClientesNuevos'],2,'Incluye Nuevo omitido y asignado');
$eq(count(array_filter($includedNew['nuevos'],static fn($r)=>$r['CodAux']==='OMITIDO')),1,'Detalle Nuevo incluido');
$eq($run(forUser:true),$includedNew,'NUEVO INCLUIR idéntico en ambos caminos');
$eq($run(true,true,false,['652'])['ClientesNuevos'],1,'Nuevo incluido no se entrega a otro propietario');
$revert($row);
$row=$make('RECUPERADO','EXCLUIR','848072001','R1','2026-11');
$eq($run(),$automatic,'Otro período no altera octubre');
$revert($row);
$row=$make('NUEVO','INCLUIR','848072001');
$result=$run();
$eq($result['recuperados'],[],'Misma regla compartida: inclusión Nuevo suprime Recuperado');
$eq($result['ClientesNuevos'],2,'Incluye Nuevo del propietario');
$revert($row);
echo "OK cartera overrides: $checksCartera validaciones; dobles controlados y SQLite en memoria, sin conexiones reales.\n";
