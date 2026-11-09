<?php
declare(strict_types=1);

require_once dirname(__DIR__).'/api/bootstrap.php';

$checks = 0;
function hrCheck(bool $condition, string $label): void
{
    global $checks;
    $checks++;
    if (!$condition) throw new RuntimeException($label);
}
function hrError(callable $operation, int $code): void
{
    try { $operation(); throw new LogicException('Se esperaba error '.$code); }
    catch (RuntimeException $e) { hrCheck($e->getCode()===$code,'Código de rechazo: '.$e->getMessage()); }
}

// Fuente oficial solo leída; todas las alteraciones siguientes son copias en memoria.
$store = new ConcursoCierreStore();
$official = $store->load(10);
if (!$official || $official['estado']!=='CERRADO') throw new RuntimeException('La prueba local requiere el Octubre oficial cerrado.');
$before = serialize($official);
$loads = $calculations = [];
$service = new ConcursoHistorialRankingService(
    static function(int $month) use ($official,&$loads): ?array { $loads[]=$month; return $month===10?$official:null; },
    static fn()=>new DateTimeImmutable('2026-11-08')
);
$history = $service->historial(25,static function(int $month) use (&$calculations): array { $calculations[]=$month; return ['puntosMes'=>7]; });
hrCheck(array_column($history,'mes')===[10,11,12],'Historial estable de tres meses');
hrCheck(array_column($history,'estado')===['CERRADO','EN CURSO','PRÓXIMO'],'Estados en Noviembre');
$paulina=array_values(array_filter($official['snapshot']['vendedores'],static fn($v)=>$v['usuarioId']===25))[0];
hrCheck($history[0]['puntos']===$paulina['totalMes'],'Octubre usa total congelado');
hrCheck($history[0]['clickeable']&&!$history[1]['clickeable']&&!$history[2]['clickeable'],'Solo cerrado abre ranking');
hrCheck($history[1]['puntos']===7&&$history[1]['actual'],'Mes actual usa puntaje vigente');
hrCheck($history[2]['puntos']===0,'Futuro cero');
hrCheck($calculations===[11],'Solo calcula Noviembre una vez; nunca Octubre ni Diciembre');
hrCheck($loads===[10,11,12],'Cada snapshot se lee una vez para el historial');
$rank=$service->ranking(['anio'=>'2026','mes'=>'10']);
$groups=array_column($rank['tramos'],'tramo');
hrCheck(array_slice($groups,0,3)===['A','B','C'],'Orden A B C');
$expected=vcHrRows($official);
$actual=[];
foreach($rank['tramos'] as $group){
    $previous=null;
    foreach($group['vendedores'] as $row){
        hrCheck(array_keys($row)===['vendedor','tramo','totalMes'],'Lista blanca exacta, sin datos sensibles');
        hrCheck($row['tramo']===$group['tramo'],'Tramo de cada fila');
        if($previous!==null)hrCheck($previous['totalMes']>$row['totalMes']||($previous['totalMes']==$row['totalMes']&&strcmp($previous['vendedor'],$row['vendedor'])<=0),'Orden puntos DESC, empate nombre ASC');
        $actual[]=$row;$previous=$row;
    }
}
usort($actual,static fn($a,$b)=>strcmp($a['vendedor'],$b['vendedor']));
hrCheck($expected===$actual,'Todos los vendedores visibles aparecen una vez con tipo y total originales');
$hidden=array_values(array_filter($official['snapshot']['vendedores'],static fn($v)=>in_array($v['usuarioId'],[42,4],true)));
hrCheck($rank['cantidadVendedores']===count($official['snapshot']['vendedores'])-count($hidden),'Snapshot menos ocultos presentes, sin conteos fijos');
foreach($hidden as $vendor)hrCheck(!in_array($vendor['vendedor'],array_column($actual,'vendedor'),true),'Identidad interna ausente de respuesta pública');
foreach($hidden as $vendor)hrCheck($service->historial($vendor['usuarioId'],static fn($m)=>['puntosMes'=>7])[0]['puntos']===$vendor['totalMes'],'La visibilidad pública no altera el historial personal de los ocultos');
$withoutMeta=count(array_filter($expected,static fn($v)=>$v['tramo']==='SIN META'));
hrCheck($rank['sinMeta']===$withoutMeta,'SIN META sin convertir en C');
if($withoutMeta)hrCheck(end($groups)==='SIN META','SIN META después de C');
foreach([11,12] as $month)hrError(fn()=>$service->ranking(['anio'=>'2026','mes'=>(string)$month]),409);
foreach([['anio'=>'2027','mes'=>'10'],['anio'=>'2026','mes'=>'9'],['anio'=>'2026','mes'=>'10','vendedorId'=>'49'],['anio'=>'2026','mes'=>'10','cliente'=>'84807201'],['anio'=>'2026','mes'=>'10','folio'=>'1']] as $query)hrError(fn()=>$service->ranking($query),400);
hrError(fn()=>$service->ranking(['anio'=>['2026'],'mes'=>'10']),400);
hrError(fn()=>$service->ranking(['anio'=>'2026','mes'=>['10']]),400);
$modified=$official;
foreach($modified['snapshot']['vendedores'] as &$v){$v['meta']=0;$v['tramo']='NO ES TIPO';}unset($v);
$frozen=new ConcursoHistorialRankingService(static fn($m)=>$modified);
hrCheck($frozen->ranking(['anio'=>2026,'mes'=>10])['tramos']===$rank['tramos'],'Ranking usa tipo congelado, no meta actual ni tramo porcentual');
foreach([10,11,12] as $month){
    $futureClosed=new ConcursoHistorialRankingService(static fn($m)=>$official);
    hrCheck($futureClosed->ranking(['anio'=>2026,'mes'=>$month])['tramos']===$rank['tramos'],'Visibilidad pública constante en cualquier mes cerrado');
}
foreach([[],[42],[4],[42,4]] as $excludedFromFixture){
    $fixture=$official;
    $fixture['snapshot']['vendedores']=array_values(array_filter($fixture['snapshot']['vendedores'],static fn($v)=>!in_array($v['usuarioId'],$excludedFromFixture,true)));
    $remainingHidden=count(array_filter($fixture['snapshot']['vendedores'],static fn($v)=>in_array($v['usuarioId'],[42,4],true)));
    $public=(new ConcursoHistorialRankingService(static fn($m)=>$fixture))->ranking(['anio'=>2026,'mes'=>10]);
    hrCheck($public['cantidadVendedores']===count($fixture['snapshot']['vendedores'])-$remainingHidden,'Conteo con ambos, uno o ningún oculto presente');
}
$renamed=$official;
foreach($renamed['snapshot']['vendedores'] as &$v)if(in_array($v['usuarioId'],[42,4],true))$v['vendedor']='Nombre interno cambiado';unset($v);
hrCheck((new ConcursoHistorialRankingService(static fn($m)=>$renamed))->ranking(['anio'=>2026,'mes'=>10])['tramos']===$rank['tramos'],'Se filtra por ID estable, no por nombre');
$db=new Database();$api=new ConcursoVentasService($db,new AnalyticsService($db),null,$service);
hrError(fn()=>$api->ranking([],['anio'=>'2026','mes'=>'10']),401);
hrCheck($api->ranking(['sub'=>25],['anio'=>'2026','mes'=>'10'])===$rank,'Vendedor autenticado obtiene proyección reducida');
$future=$api->puntaje(['sub'=>25],['anio'=>'2026','mes'=>'12']);
hrCheck($future['puntosMes']===0&&$future['estadoMes']==='PRÓXIMO','Puntaje futuro sin conexiones DB');
$js=file_get_contents(dirname(__DIR__).'/src/modulo/ventas/dashboard/dashboard.js');
hrCheck(str_contains($js,"apiBase: '/api/dashboard/concurso-detalle'")&&str_contains($js,'params: getParams()'),'Ver conserva detalle personal del período seleccionado');
$mutated=$official;$mutated['snapshot']['vendedores'][]=$mutated['snapshot']['vendedores'][0];
hrError(fn()=>(new ConcursoHistorialRankingService(static fn($m)=>$mutated))->ranking(['anio'=>2026,'mes'=>10]),409);
hrCheck(serialize($store->load(10))===$before,'Snapshot oficial sin cambios');
echo "OK concurso historial ranking: $checks comprobaciones; fuentes controladas en memoria, cierre oficial solo lectura, sin MySQL ni Softland.\n";

function vcHrRows(array $snapshot): array
{
    $visible=array_filter($snapshot['snapshot']['vendedores'],static fn($v)=>!in_array($v['usuarioId'],[42,4],true));
    $rows=array_values(array_map(static fn($v)=>['vendedor'=>$v['vendedor'],'tramo'=>$v['tipo'],'totalMes'=>$v['totalMes']],$visible));
    usort($rows,static fn($a,$b)=>strcmp($a['vendedor'],$b['vendedor']));
    return $rows;
}
