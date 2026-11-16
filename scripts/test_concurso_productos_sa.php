<?php
declare(strict_types=1);

// Fuente comercial simulada en memoria. Nunca conecta a SQL Server ni modifica BD locales.
require_once dirname(__DIR__) . '/api/src/Env.php';
require_once dirname(__DIR__) . '/api/src/SharedServiceHelpers.php';
require_once dirname(__DIR__) . '/api/src/AnalyticsService.php';
require_once dirname(__DIR__) . '/api/src/ConcursoPromediosService.php';

final class ConcursoSaPDO extends PDO
{
    public function __construct()
    {
        parent::__construct('sqlite::memory:');
        $this->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->exec('CREATE TABLE iw_gsaen (NroInt INT,Tipo TEXT,Folio INT,Fecha TEXT,CodAux TEXT,NomAux TEXT,CodVendedor TEXT,Estado TEXT)');
        $this->exec('CREATE TABLE iw_gmovi (NroInt INT,Tipo TEXT,CodProd TEXT,TotLinea REAL,CantFacturada REAL)');
        $this->exec('CREATE TABLE iw_tprod (CodProd TEXT,DesProd TEXT,CtaVentas TEXT)');
        foreach ([10,11,12] as $month) $this->exec("INSERT INTO iw_gsaen VALUES ($month,'F',".(123+$month).",'2026".$month."15','CLI','Cliente ficticio','V1','V')");
        foreach (['SA-07-0001','sa-03-0001',' SA-04-0001 ','SA-06-0001','SA-08-0001','SA-10-0001','SA-XX','NO-SA'] as $code) {
            $stmt = parent::prepare('INSERT INTO iw_tprod VALUES (?,?,?)');
            $stmt->execute([$code,'Descripción sin clasificación','Q']);
            $stmt = parent::prepare('INSERT INTO iw_gmovi VALUES (?,\'F\',?,100,1)');
            foreach ([10,11,12] as $month) $stmt->execute([$month,$code]);
        }
    }

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        // Traducir solo el dialecto del SELECT real, manteniendo su agrupación y filtros.
        $query = preg_replace('/\[PRODIN\]\.\[softland\]\.\[(iw_\w+)\]/', '$1', $query);
        $query = str_replace('CONVERT(varchar(10), h.Fecha, 120)', "substr(h.Fecha,1,4)||'-'||substr(h.Fecha,5,2)||'-'||substr(h.Fecha,7,2)", $query);
        $query = str_replace('CONVERT(varchar(250), t.DesProd)', 't.DesProd', $query);
        $query = str_replace('CONVERT(varchar(250), h.NomAux)', 'h.NomAux', $query);
        $query = preg_replace('/SUM\(CONVERT\(decimal\(38,6\), (CASE.*?END)\)\)/s', 'SUM($1)', $query);
        return parent::prepare($query, $options);
    }
}

final class Database
{
    public function __construct(private PDO $fixture) {}
    public function softland(): PDO { return $this->fixture; }
    public function fetchAll(string $sql, array $params = []): array
    {
        if (str_contains($sql, 'FROM usuario u')) return [['usuarioId'=>1,'codigoPrincipal'=>'V1','vendedor'=>'Ficticio','codigoAsociado'=>'V1','tipo'=>'P']];
        if (str_contains($sql, 'FROM categoriasproducto')) return [['Cta'=>'Q','Categoria'=>'QUIMICOS']];
        if (str_contains($sql, 'FROM factura_compartida')) return [];
        throw new RuntimeException('Consulta no prevista en fixture.');
    }
}

$checks = 0;
$check = static function (bool $ok, string $message) use (&$checks): void {
    if (!$ok) throw new RuntimeException($message);
    $checks++;
};
$db = new Database(new ConcursoSaPDO());
$analytics = new AnalyticsService($db);
$service = new ConcursoPromediosService($db, $analytics);
$classify = new ReflectionMethod($service, 'categoria');
foreach (['SA-07-0001','sa-07-0001',' SA-07-0001 ','SA-XX','SA-03-0001','SA-04-0001','SA-06-0001','SA-08-0001','SA-10-0001'] as $code) {
    foreach (['QUIMICOS','ACCESORIOS','AEROSOLES','TAGUAS','DESCONOCIDA'] as $account) {
        foreach ([false,true] as $shared) $check($classify->invoke($service,$account,$code,$shared,'2026-11')==='ACCESORIOS', 'Prioridad absoluta SA-: '.$code);
    }
}
foreach (['QUIMICOS'=>'QUIMICOS','QUÍMICOS'=>'QUIMICOS','ACCESORIOS'=>'ACCESORIOS','PAPEL'=>'ACCESORIOS','SACHETS'=>'ACCESORIOS','TAGUAS'=>'TRAT_AGUA','TRAT_AGUA'=>'TRAT_AGUA','AEROSOL'=>'AEROSOLES','AEROSOLES'=>'AEROSOLES','DESCONOCIDA'=>null] as $name=>$expected) {
    foreach (['NO-SA','SA','XSA-07-0001',''] as $code) {
        $check($classify->invoke($service,$name,$code,false,'2026-11')===$expected, 'No SA- conserva clasificación: '.$name);
        $check($classify->invoke($service,$name,$code,true,'2026-11')==='TRAT_AGUA', 'No SA- conserva atribución compartida');
    }
}
foreach ([false,true] as $products) {
    $source = $analytics->concursoPromediosFuente('2026-11','2026-11',$products);
    $check(count($source['ventas'])===2, 'Fuente separa SA- de no SA- en la misma factura/cuenta');
    $check(array_sum(array_column($source['ventas'],'original'))===800.0, 'Fuente conserva importe total');
}
$summary = $service->calcular(null,null,null,'2026-11','2026-11');
$totals = [];
foreach ($summary['registros'] as $record) $totals[$record['categoria']]=$record['ventas_mensuales']['2026-11'];
$check($totals===['QUIMICOS'=>100,'ACCESORIOS'=>700,'TRAT_AGUA'=>0,'AEROSOLES'=>0], 'Resumen exclusivo: SA- solo en accesorios y no SA- intacto');
$seen = [];
foreach (['QUIMICOS','ACCESORIOS','TRAT_AGUA','AEROSOLES','OTROS'] as $category) {
    $detail=$service->calcular(1,$category,11,'2026-11','2026-11');
    $check($detail['total']===($totals[$category]??0), 'Detalle coincide con resumen: '.$category);
    foreach ($detail['documentos'] as $doc) {
        $code=$doc['codigoProducto'];
        $check(!isset($seen[$code]), 'Producto no contabilizado simultáneamente en dos categorías');
        $seen[$code]=$category;
        $check($category===(str_starts_with(strtoupper(trim($code)),'SA-')?'ACCESORIOS':'QUIMICOS'), 'Categoría efectiva en detalle');
    }
}
$check(count($seen)===8, 'Ningún producto perdido');

// Reproducir la mezcla de tab+SA con otros productos en la misma cuenta/factura.
// Solo se modifica la fixture SQLite en memoria y se revierte al terminar.
$fixture=$db->softland();
$fixture->beginTransaction();
try {
    $cases=["\tSA-EXTRA"=>true,"\r\n SA-BLANCOS\v\t"=>true,'NO-SA-07-0001'=>false,'XX-SA-07-0001'=>false,"S\tA-INTERNO"=>false,"SA\t-INTERNO"=>false];
    foreach ($cases as $code=>$isSa) {
        $stmt=$fixture->prepare('INSERT INTO iw_tprod VALUES (?,?,?)');$stmt->execute([$code,'Prueba de normalización','Q']);
        $stmt=$fixture->prepare("INSERT INTO iw_gmovi VALUES (?,'F',?,100,1)");
        foreach ([10,11,12] as $month) $stmt->execute([$month,$code]);
    }
    foreach ([10,11,12] as $month) {
        $periodo='2026-'.$month;
        $actual=[];
        foreach (['QUIMICOS','ACCESORIOS','TRAT_AGUA','AEROSOLES','OTROS'] as $category) {
            $detail=$service->calcular(1,$category,$month,$periodo,$periodo);
            foreach ($detail['documentos'] as $doc) {
                $code=rtrim($doc['codigoProducto']);
                $check(!isset($actual[$code]), 'Normalización conserva exclusividad: '.$code);
                $actual[$code]=$category;
            }
        }
        foreach ($cases as $code=>$isSa) {
            $expected=$month!==10 && $isSa?'ACCESORIOS':'QUIMICOS';
            $check(($actual[rtrim($code)]??null)===$expected, 'Prefijo normalizado sin coincidencia interna: '.$periodo.' '.json_encode($code));
        }
        $check($actual['NO-SA']==='QUIMICOS','Tab+SA no arrastra NO-SA a accesorios');
        foreach ([false,true] as $products) {
            $source=$analytics->concursoPromediosFuente($periodo,$periodo,$products);
            $check(count($source['ventas'])===($month===10?1:2),'SQL y PHP mantienen agrupación equivalente');
        }
    }
} finally { $fixture->rollBack(); }
// Período explícito: nunca usar la fecha del servidor ni extender la excepción a 2027.
foreach (['2026-06','2026-10','2027-01','2027-11','2027-12'] as $periodo) {
    foreach (['QUIMICOS'=>'QUIMICOS','AEROSOLES'=>'AEROSOLES','TAGUAS'=>'TRAT_AGUA','DESCONOCIDA'=>null] as $account=>$expected) {
        $check($classify->invoke($service,$account,'SA-07-0001',false,$periodo)===$expected, 'Histórico sin override: '.$periodo);
        $check($classify->invoke($service,$account,'SA-07-0001',true,$periodo)==='TRAT_AGUA', 'Atribución histórica sin override: '.$periodo);
    }
}
foreach (['2026-11','2026-12'] as $periodo) {
    foreach (['QUIMICOS','AEROSOLES','TAGUAS','DESCONOCIDA'] as $account) foreach ([false,true] as $shared) {
        $check($classify->invoke($service,$account,'SA-07-0001',$shared,$periodo)==='ACCESORIOS', 'Override exclusivo: '.$periodo);
    }
}
foreach (['2026-10'=>1,'2026-11'=>2,'2026-12'=>2] as $periodo=>$groups) {
    foreach ([false,true] as $products) {
        $source=$analytics->concursoPromediosFuente($periodo,$periodo,$products);
        $check(count($source['ventas'])===$groups, 'Agrupación histórica/temporal: '.$periodo);
    }
    $result=$service->calcular(null,null,null,$periodo,$periodo);
    $values=[];
    foreach ($result['registros'] as $record) $values[$record['categoria']]=$record['ventas_mensuales'][$periodo];
    $expected=$periodo==='2026-10'?['QUIMICOS'=>800,'ACCESORIOS'=>0,'TRAT_AGUA'=>0,'AEROSOLES'=>0]:['QUIMICOS'=>100,'ACCESORIOS'=>700,'TRAT_AGUA'=>0,'AEROSOLES'=>0];
    $check($values===$expected, 'Cálculo vivo respeta el período incluso en octubre: '.$periodo);
    foreach (['QUIMICOS','ACCESORIOS','TRAT_AGUA','AEROSOLES','OTROS'] as $category) {
        $detail=$service->calcular(1,$category,(int)substr($periodo,5),$periodo,$periodo);
        $check($detail['total']===($values[$category]??0), 'Detalle exclusivo por período '.$periodo.' '.$category);
    }
}
$range=$service->calcular(null,null,null,'2026-10','2026-12');
$byCategory=array_column($range['registros'],null,'categoria');
$check($byCategory['ACCESORIOS']['ventas_mensuales']===['2026-10'=>0,'2026-11'=>700,'2026-12'=>700], 'Rango mixto aplica la excepción por período de cada fila');
$check($byCategory['QUIMICOS']['ventas_mensuales']===['2026-10'=>800,'2026-11'=>100,'2026-12'=>100], 'Rango mixto conserva octubre');

// Cambiar noviembre -> octubre -> noviembre: consultar el detalle congelado real
// en octubre y el cálculo vigente en noviembre. Ninguna conexión ni escritura.
require_once dirname(__DIR__).'/api/src/Security.php';
require_once dirname(__DIR__).'/api/src/GerenciaService.php';
$store=new ConcursoCierreStore();
$official=$store->load(10);
$check(($official['estado']??null)==='CERRADO','Octubre local tiene cierre congelado');
$before=serialize($official);
$frozenVendor=$official['snapshot']['vendedores'][0];
$frozenCategory=$frozenVendor['productos'][0];
$gerencia=new GerenciaService($db,$analytics);
$selectorResponses=[];
foreach ([11,10,11] as $selectedMonth) {
    if ($selectedMonth===10) {
        $response=$gerencia->concursoProductosUsuario(['sub'=>$frozenVendor['usuarioId']],['anio'=>'2026','mes'=>'10','categoria'=>$frozenCategory['categoria'],'detalle'=>'venta']);
        $check($response['documentos']===$frozenCategory['documentos'] && $response['total']===$frozenCategory['ventaMes'], 'Seleccionar octubre devuelve exactamente el detalle congelado sin fuente comercial');
    } else {
        $response=$service->calcular(1,'ACCESORIOS',$selectedMonth,'2026-11','2026-11');
        $check($response['total']===700 && count($response['documentos'])===7, 'Seleccionar/volver a noviembre aplica SA- exclusivamente');
    }
    $selectorResponses[$selectedMonth]=['ok'=>true,'visible'=>true,'estadoMes'=>$selectedMonth===10?'CERRADO':'EN CURSO','puntosMes'=>$response['total'],'documentos'=>$response['documentos']];
}
$check(serialize($store->load(10))===$before,'Snapshot octubre idéntico tras cambiar períodos');
echo "OK productos SA-: $checks verificaciones; fuente y cálculo reales con SQLite en memoria, sin conexiones externas.\n";

if (in_array('--ui', $argv, true)) {
    // Ejecutar en Chrome las funciones y el binding reales del selector. Solo fetch simulado.
    $dashboard=file_get_contents(dirname(__DIR__).'/src/modulo/ventas/dashboard/dashboard.js');
    $extract=static function (string $start,string $end) use ($dashboard): string {
        $position=strpos($dashboard,$start);
        if ($position===false) throw new RuntimeException('No se encontró función UI: '.$start);
        $finish=strpos($dashboard,$end,$position);
        if ($finish===false) throw new RuntimeException('No se encontró límite UI: '.$end);
        return substr($dashboard,$position,$finish-$position);
    };
    $functions=$extract('  function getParams() {','  function getCarteraParams() {')
        .$extract('  async function cargarPuntajeConcurso() {','  function renderDetalleConcurso(data) {');
    $binding=$extract("    ['filtroMes', 'filtroAnio'].forEach",'    const bVentas =');
    $fixture=json_encode($selectorResponses,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
    $script=<<<'JS'
const API='/api/dashboard',token=()=>'',periodoActual=()=>({mes:1,anio:2099}),MESES_NOMBRE=Array.from({length:12},(_,i)=>String(i+1));
const setText=()=>{};let rendered,pending,requests=[];
const renderDetalleConcurso=data=>{rendered=data;};
const cargarTodo=()=>{pending=cargarPuntajeConcurso();};
window.fetch=async url=>{const params=new URL(url,'http://localhost').searchParams;const mes=params.get('mes');if(params.get('anio')!=='2026')throw Error('Usó fecha actual');requests.push(Number(mes));return {json:async()=>fixtures[mes]};};
JS;
    $checksJs=<<<'JS'
(async()=>{
 try {
  for(const month of [11,10,11]) {
   document.getElementById('filtroMes').value=String(month);
   document.getElementById('filtroMes').dispatchEvent(new Event('change'));
   await pending;
   if(JSON.stringify(rendered)!==JSON.stringify(fixtures[month]))throw Error('Respuesta del período incorrecta');
   if(month===10&&rendered.estadoMes!=='CERRADO')throw Error('Octubre no muestra cierre');
   if(month===11&&(rendered.documentos.length!==7||rendered.documentos.some(doc=>doc.categoriaConcurso!=='ACCESORIOS'||!doc.codigoProducto.trim().toUpperCase().startsWith('SA-'))))throw Error('Noviembre no es exclusivo');
  }
  if(JSON.stringify(requests)!=='[11,10,11]')throw Error('Selector no actualizó las peticiones');
  document.body.innerHTML='<output id="ui-result">OK selector noviembre -> octubre congelado -> noviembre; JavaScript real, respuestas controladas</output>';
 } catch(error) {document.body.innerHTML='<output id="ui-result">ERROR '+error.message+'</output>';}
})();
JS;
    $temp=sys_get_temp_dir().'/concurso-sa-periodo-'.bin2hex(random_bytes(6));
    mkdir($temp);
    $path=$temp.'/selector.html';
    file_put_contents($path,'<!doctype html><select id="filtroMes"><option>10</option><option>11</option></select><select id="filtroAnio"><option>2026</option></select><script>const fixtures='.$fixture.';'.$script.$functions.$binding.$checksJs.'</script>');
    $chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
    if(!is_file($chrome))throw new RuntimeException('Chrome local no disponible.');
    $process=proc_open([$chrome,'--headless','--disable-gpu','--disable-background-networking','--disable-extensions','--no-first-run','--dump-dom','--virtual-time-budget=10000','--user-data-dir='.$temp.'/profile','file:///'.str_replace('\\','/',$path)],
        [0=>['pipe','r'],1=>['pipe','w'],2=>['file',$temp.'/chrome.log','w']],$pipes);
    if(!is_resource($process))throw new RuntimeException('No se pudo iniciar Chrome.');
    fclose($pipes[0]);$output=stream_get_contents($pipes[1]);fclose($pipes[1]);proc_close($process);
    if(!preg_match('#<output id="ui-result">([^<]+)#',$output,$match))throw new RuntimeException('Chrome no devolvió resultado. Log: '.$temp);
    if(!str_starts_with($match[1],'OK '))throw new RuntimeException($match[1]);
    echo html_entity_decode($match[1])."\n";
    $check(serialize($store->load(10))===$before,'Snapshot octubre idéntico después de UI');
}

// Diagnóstico opcional: exclusivamente SELECT en bdtexpro loopback y lectura de cierres.
if (in_array('--local', $argv, true)) {
    load_env_file(dirname(__DIR__).'/.env');
    if (!in_array(strtolower(trim((string)env('DB_HOST',''))),['localhost','127.0.0.1'],true) || env('DB_NAME','')!=='bdtexpro') {
        throw new RuntimeException('Diagnóstico abortado: solo bdtexpro LOCAL.');
    }
    $pdo = new PDO('mysql:host='.env('DB_HOST').';port='.(int)env('DB_PORT',3306).';dbname=bdtexpro;charset=utf8mb4', (string)env('DB_USER'),(string)env('DB_PASSWORD'),[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('START TRANSACTION READ ONLY');
    try {
        $columns=$pdo->query("SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND (LOWER(COLUMN_NAME) IN ('folio','codprod','codigo_producto','codigoproducto')) ORDER BY TABLE_NAME,COLUMN_NAME")->fetchAll(PDO::FETCH_ASSOC);
        $tables=[];
        foreach($columns as $column) $tables[$column['TABLE_NAME']][strtolower($column['COLUMN_NAME'])]=$column['COLUMN_NAME'];
        foreach([381765,381770,381768,381771,381769] as $folio) {
            $found=[];
            foreach($tables as $table=>$fields) {
                if (!isset($fields['folio']) || !preg_match('/^[a-zA-Z0-9_]+$/D',$table)) continue;
                $product=$fields['codprod']??$fields['codigo_producto']??$fields['codigoproducto']??null;
                $select=$product?'`'.$product.'`':'NULL';
                $stmt=$pdo->prepare('SELECT '.$select.' AS producto FROM `'.$table.'` WHERE `'.$fields['folio'].'`=?');
                $stmt->execute([$folio]);$rows=$stmt->fetchAll(PDO::FETCH_ASSOC);
                if ($rows) $found[]=['tabla'=>$table,'filas'=>count($rows),'productos'=>$product?array_values(array_unique(array_column($rows,'producto'))):'Sin detalle de productos'];
            }
            echo 'Folio '.$folio.': '.json_encode($found?:'No disponible en tablas MySQL locales con folio',JSON_UNESCAPED_UNICODE)."\n";
        }
    } finally { $pdo->rollBack(); }
    $closure=(new ConcursoCierreStore())->load(11);
    echo '2026-11: '.($closure['estado']??'SIN CIERRE LOCAL (cálculo en vivo)').". No se creó ni sobrescribió ningún cierre.\n";
}
