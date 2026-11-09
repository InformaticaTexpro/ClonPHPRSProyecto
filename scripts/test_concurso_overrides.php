<?php
declare(strict_types=1);

// Fuentes controladas, MySQL SQLite y snapshot CERRADO simulado solo en TEMP.
$concursoTemp = sys_get_temp_dir() . '/concurso-overrides-' . bin2hex(random_bytes(8));
function env(string $key, mixed $default = null): mixed { global $concursoTemp; return $key === 'CONCURSO_CIERRES_DIR' ? $concursoTemp : $default; }
require __DIR__ . '/test_concurso_ventas.php';
require_once dirname(__DIR__) . '/api/src/GerenciaService.php';

final class ConcursoOverrideMysqlPDO extends PDO
{
    public int $reads = 0;
    public function __construct() { parent::__construct('sqlite::memory:'); $this->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION); }
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        if (str_contains($query, 'SELECT * FROM cliente_clasificacion_override')) $this->reads++;
        return parent::prepare($query,$options);
    }
}
final class ConcursoOverrideDB extends Database
{
    public function __construct(PDO $source, private PDO $mysql, array $shares = []) { parent::__construct($source,$shares); }
    public function mysql(): PDO { return $this->mysql; }
}
$mysql = new ConcursoOverrideMysqlPDO();
$mysql->exec('CREATE TABLE cliente_clasificacion_override (
    id INTEGER PRIMARY KEY AUTOINCREMENT, periodo TEXT, tipo_evento TEXT, accion TEXT, rut_normalizado TEXT,
    rut_original TEXT, codaux TEXT, tipo_documento TEXT, folio TEXT, nroint TEXT, fecha_documento TEXT,
    cliente_nombre TEXT, codigo_vendedor_origen TEXT, motivo_codigo TEXT, motivo_detalle TEXT, datos_validacion TEXT,
    creado_por INTEGER, creado_por_nombre TEXT, creado_en TEXT DEFAULT CURRENT_TIMESTAMP, activo INTEGER DEFAULT 1,
    revertido_por INTEGER, revertido_por_nombre TEXT, revertido_en TEXT, motivo_reversion TEXT)');
$central = new ClienteClasificacionOverrideService(new ConcursoOverrideDB(new ConcursoClientPDO([]),$mysql));
$actor = ['usuarioId'=>1,'nombre'=>'ADMIN TEST'];
$checksConcurso = 0;
$eq = static function ($actual,$expected,string $label) use (&$checksConcurso): void {
    $checksConcurso++; if ($actual !== $expected) throw new RuntimeException($label . ': ' . json_encode([$actual,$expected]));
};
$make = static function (string $kind,string $action,string $period = '2026-10') use ($central,$actor): array {
    return $central->crear(['periodo'=>$period,'tipoEvento'=>$kind,'accion'=>$action,'rut'=>'84.807.200-1','codaux'=>'84807201',
        'tipoDocumento'=>'F','folio'=>'380985','nroint'=>'123','fechaDocumento'=>$period.'-05','clienteNombre'=>'BRUNO FRITSCH SA',
        'codigoVendedorOrigen'=>'479','motivoCodigo'=>'TEST_CONCURSO','motivoDetalle'=>'AUDITORIA PRIVADA',
        'datosValidacion'=>['folio'=>'380985','nroint'=>'123','fecha'=>$period.'-05','rut'=>'84.807.200-1','codaux'=>'84807201',
            'monto'=>324017,'vendedorOrigen'=>['codigo'=>'479','nombre'=>'Vendedor TEST'],'compartidos'=>[]]],$actor);
};
$revert = static fn(array $row) => $central->revertir((int)$row['id'],$actor,'Fin de prueba');
$context = static function (array $options = [], bool $enabled = true) use ($mysql,$central): array {
    $shared = $options['shared'] ?? false;
    $relations = [['usuarioId'=>1,'codigoAsociado'=>'479','codigoPrincipal'=>'479','vendedor'=>'Vendedor TEST','tipo'=>$shared?'C':'P'],
        ['usuarioId'=>2,'codigoAsociado'=>'652','codigoPrincipal'=>'652','vendedor'=>'Compartido TEST','tipo'=>'C']];
    $first = $options['new'] ?? false ? '2026-10-05' : '2024-01-01';
    $previous = $options['new'] ?? false ? null : ($options['previous'] ?? '2026-01-12');
    $clients = [['clienteCodigo'=>'84807201','cliente'=>'BRUNO FRITSCH SA','primera'=>$first,'ultimaPrevia'=>$previous]];
    $history = [['CodAux'=>'84807201','Identidad'=>'RUT:848072001','FechaPrimeraRut'=>$first,'CodAuxPrimero'=>'84807201',
        'Vendedor'=>'479','NroInt'=>123,'Folio'=>380985]];
    $docs = [['clienteCodigo'=>'84807201','codigoVendedor'=>'479','NroInt'=>123,'tipo'=>'F','folio'=>380985,'fecha'=>'2026-10-05','original'=>$options['amount']??324017]];
    if ($options['alias'] ?? false) {
        $clients[] = array_replace($clients[0],['clienteCodigo'=>'ALIAS']);
        $history[] = array_replace($history[0],['CodAux'=>'ALIAS']);
        $docs[] = array_replace($docs[0],['clienteCodigo'=>'ALIAS','NroInt'=>124,'folio'=>380986]);
    }
    $shares = $shared ? [['folio'=>380985,'fecha'=>'2026-10-05','porcentaje'=>50,'origen'=>'479','destino'=>'652']] : [];
    $pdo = new ConcursoClientPDO([$clients,$history,[['clienteCodigo'=>'84807201','vendedor'=>'479']],$docs]);
    $db = new ConcursoOverrideDB($pdo,$mysql,$shares);
    return [$db,new AnalyticsService($db,$enabled?$central:null),$relations,$pdo];
};
$run = static function (array $options = [], bool $enabled = true, int $user = 1) use ($context): array {
    [, $analytics,$relations] = $context($options,$enabled);
    return $analytics->concursoClientes($relations,10,$user,null,true,true);
};
$auto = $run([],false);
$mysql->reads=0;
$eq($run(),$auto,'Sin overrides idéntico al motor automático');
$eq($mysql->reads,1,'Overrides cargados una vez');
$exclude=$make('RECUPERADO','EXCLUIR');
$excluded=$run();
$eq($excluded['clientes'],[],'Evento retirado, no fila con puntos cero');
$eq($excluded['resumen'][1]['clientesRecuperados'],$auto['resumen'][1]['clientesRecuperados']-1,'Un recuperado menos');
$eq((float)$excluded['resumen'][1]['puntosRecuperados'],(float)$auto['resumen'][1]['puntosRecuperados']-3.0,'Tres puntos menos');
$eq($run(['alias'=>true])['clientes'],[],'Decisión global sobre varios CodAux del RUT');
foreach ([1,2] as $id) {
    $r=$run(['shared'=>true],true,$id);
    $eq($r['clientes'],[],'Compartida excluida sin fila residual');
    $eq((float)$r['resumen'][$id]['puntosRecuperados'],0.0,'Ningún participante recibe puntos');
}
$source=file_get_contents(dirname(__DIR__).'/api/src/AnalyticsService.php');
$eq(strpos($source,'$classified = $this->concursoAplicarClasificacionEfectiva(')<strpos($source,'self::splitSharedTypeCClientPoints($participants'),true,'Clasificación efectiva antes del split');
$revert($exclude);
$eq($run(),$auto,'Revertir devuelve exactamente los eventos y puntos automáticos');
$newExclude=$make('NUEVO','EXCLUIR');
$eq($run(['new'=>true])['clientes'],[],'NUEVO EXCLUIR no aparece ni puntúa');
$revert($newExclude);
$include=$make('RECUPERADO','INCLUIR');
$eq($run(),$auto,'Inclusión ya existente no duplica');
$under=$run(['previous'=>'2026-09-30','amount'=>150000]);
$eq($under['clientes'][0]['categoria'],'recuperados','Forzar categoría de evento real omitido');
$eq($under['clientes'][0]['califica'],false,'Inclusión bajo mínimo no califica');
$eq($under['clientes'][0]['puntos'],0.0,'Inclusión bajo mínimo sin puntos');
$over=$run(['previous'=>'2026-09-30']);
$eq($over['clientes'][0]['puntos'],3.0,'Inclusión sobre mínimo usa puntos normales');
$eq($over['clientes'][0]['dias'],5,'Conserva días reales, no inventa antigüedad');
$eq($over['clientes'][0]['folios'][0]['atribuida'],324017.0,'Conserva atribución real');
$eq($run(['new'=>true])['clientes'][0]['categoria'],'recuperados','Inclusión Recuperado prevalece sobre Nuevo');
foreach ([1,2] as $id) $eq($run(['previous'=>'2026-09-30','shared'=>true],true,$id)['clientes'][0]['puntos'],1.5,'Inclusión compartida conserva distribución normal');
$json=json_encode($over);
foreach (['AUDITORIA PRIVADA','overrideId','_clasificacionEfectiva','creado_por','TEST_CONCURSO'] as $private) $eq(str_contains($json,$private),false,'Privacidad vendedor: '.$private);

// Congelación en memoria: vuelve a consultar concursoClientes y debe conservar la categoría efectiva.
[$db,$analytics,$relations]=$context(['previous'=>'2026-09-30']);
$gerencia=new GerenciaService($db,$analytics);
(new ReflectionProperty(GerenciaService::class,'vendorRelations'))->setValue($gerencia,$relations);
$item=['usuarioId'=>1,'codigoPrincipal'=>'479','vendedor'=>'Vendedor TEST','meta'=>30000000.0,'venta'=>30000000.0,
    'desgloseVenta'=>['baseAsociada'=>30000000.0,'compartidaRecibida'=>0.0,'compartidaCedida'=>0.0],
    'clientesNuevos'=>0,'puntosNuevos'=>0,'clientesRecuperados'=>1,'puntosRecuperados'=>3.0,'productosPuntos'=>0,'productos'=>[]]
    + GerenciaService::evaluarMetaConcurso(30000000,30000000);
$item['totalMes']=$item['puntosMeta']+3.0;
$vendorBase=['categorias'=>[]];
foreach (ConcursoBaseOficialStore::CATEGORIAS as $category) {
    $item['productos'][]=['categoria'=>$category,'promedioBase'=>0.0,'ventaMes'=>0.0,'superacion'=>0.0,'puntos'=>0,'documentos'=>[]];
    $vendorBase['categorias'][$category]=['promedioBase'=>0.0,'meses'=>['2026-09'=>0.0]];
}
$frozen=(new ReflectionMethod(GerenciaService::class,'concursoCongelarVendedor'))->invoke($gerencia,$item,$vendorBase,10);
$eq($frozen['clientes']['recuperados'][0]['dias'],5,'Congelar mantiene días reales');
$eq($frozen['clientes']['recuperados'][0]['_clasificacionEfectiva']['overrideId'],(int)$include['id'],'Prueba de inclusión solo en congelación');
$snapshot=['schemaVersion'=>1,'anioConcurso'=>2026,'periodo'=>'2026-10','estado'=>'CERRADO','version'=>1,'fechaCierre'=>'TEST',
    'cerradoPor'=>['usuarioId'=>1],'baseOficial'=>['version'=>1,'periodoDesde'=>'2026-09','periodoHasta'=>'2026-09'],
    'snapshot'=>['vendedores'=>[$frozen]]];
$store=new ConcursoCierreStore();
$store->validate($snapshot,10);$eq(true,true,'Inclusión válida permite validar el futuro cierre en memoria');
$noProof=$snapshot;unset($noProof['snapshot']['vendedores'][0]['clientes']['recuperados'][0]['_clasificacionEfectiva']);
try {$store->validate($noProof,10);throw new LogicException('Debió exigir prueba congelada');}
catch(RuntimeException $e){$eq($e->getMessage(),'Cliente inválido.','Sin prueba conserva validación histórica');}
$revert($include);
$includeNew=$make('NUEVO','INCLUIR');
$forced=$run();
$eq($forced['clientes'][0]['categoria'],'nuevos','INCLUIR Nuevo fuerza categoría');
$eq($forced['clientes'][0]['puntos'],5.0,'Nuevo con venta suficiente puntúa normal');
$eq($forced['resumen'][1]['clientesRecuperados'],0,'No termina en ambas categorías');
$eq($run(['amount'=>150000])['clientes'][0]['puntos'],0.0,'Nuevo manual bajo mínimo no puntúa');
$revert($includeNew);
$other=$make('RECUPERADO','EXCLUIR','2026-11');$eq($run(),$auto,'Otro mes no afecta');$revert($other);

// Sin candidato: revalida evidencia/documento y deja diagnóstico fuera de la respuesta del vendedor.
$include=$make('RECUPERADO','INCLUIR');
$pdo=new ConcursoClientPDO([[],[]]);$dbMissing=new ConcursoOverrideDB($pdo,$mysql);
$missingAnalytics=new AnalyticsService($dbMissing,$central);
$missing=$missingAnalytics->concursoClientes($relations,10,1);
$eq($missing['clientes'],[],'No fabrica eventos sin documento compatible');
$eq((float)$missing['resumen'][1]['puntosRecuperados'],0.0,'No fabrica puntos');
$eq($missingAnalytics->concursoOverrideDiagnosticos()[0]['condicion'],'DOCUMENTO_NO_VERIFICABLE','Diagnóstico administrativo disponible');
$eq(str_contains(json_encode($missing),'DOCUMENTO_NO_VERIFICABLE'),false,'Diagnóstico no expuesto al vendedor');
$failingSource = new class([[]]) extends ConcursoClientPDO {
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        if (str_starts_with($query,'SELECT h.NroInt')) throw new PDOException('ERROR_INTERNO_PRIVADO');
        return parent::prepare($query,$options);
    }
};
$unavailable = new AnalyticsService(new ConcursoOverrideDB($failingSource,$mysql),$central);
$safe = $unavailable->concursoClientes($relations,10,1);
$eq($unavailable->concursoOverrideDiagnosticos()[0]['condicion'],'VERIFICACION_NO_DISPONIBLE','Fallo de reconstrucción solo administrativo');
$eq(str_contains(json_encode($safe),'ERROR_INTERNO_PRIVADO'),false,'Error interno no se envía al vendedor');
$revert($include);

// CERRADO siempre usa el fixture oficial aislado, incluso con EXCLUIR vigente.
$exclude=$make('RECUPERADO','EXCLUIR');
mkdir($concursoTemp);
try {
    file_put_contents($concursoTemp.'/2026-10.json',json_encode($snapshot,JSON_THROW_ON_ERROR|JSON_PRESERVE_ZERO_FRACTION));
    $hash=hash_file('sha256',$concursoTemp.'/2026-10.json');
    $emptySource=new ConcursoClientPDO([]);$closedDb=new ConcursoOverrideDB($emptySource,$mysql);
    $closedAnalytics=new AnalyticsService($closedDb,$central);$closedGerencia=new GerenciaService($closedDb,$closedAnalytics);
    $mysql->reads=0;
    $detail=$closedGerencia->concursoDetalleUsuario(['sub'=>1],['anio'=>'2026','mes'=>'10']);
    $eq($detail['row']['totalMes'],$frozen['totalMes'],'Gerencia cerrada conserva total congelado');
    $clientsClosed=$closedGerencia->concursoClientesUsuario(['sub'=>1],['anio'=>'2026','mes'=>'10','categoria'=>'recuperados']);
    $eq(count($clientsClosed['clientes']),1,'Override actual no retira cliente cerrado');
    $eq(isset($clientsClosed['clientes'][0]['_clasificacionEfectiva']),false,'Prueba congelada privada');
    $score=(new ConcursoVentasService($closedDb,$closedAnalytics))->puntaje(['sub'=>1],['anio'=>'2026','mes'=>'10']);
    $eq($score['puntosMes'],$frozen['totalMes'],'Fallback usa mismo total que Gerencia');
    $eq($mysql->reads,0,'Mes cerrado no consulta overrides');
    $eq($emptySource->queries,[],'Mes cerrado no consulta Softland');
    $eq(hash_file('sha256',$concursoTemp.'/2026-10.json'),$hash,'Snapshot cerrado inmutable');
} finally { unlink($concursoTemp.'/2026-10.json');rmdir($concursoTemp); }
$revert($exclude);
echo "OK concurso overrides: $checksConcurso validaciones; dobles, SQLite y snapshot simulado en TEMP. Sin cierre real.\n";
