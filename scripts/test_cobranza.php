<?php
declare(strict_types=1);

require_once __DIR__ . '/test_concurso_ventas.php';
require_once dirname(__DIR__) . '/api/src/Env.php';
require_once dirname(__DIR__) . '/api/src/CobranzaService.php';

// SQL real en memoria. Solo se adapta sintaxis T-SQL; nunca se conecta a las BD de la empresa.
final class CobranzaTestPDO extends PDO
{
    public int $queries = 0;
    public function __construct()
    {
        parent::__construct('sqlite::memory:');
        $this->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->sqliteCreateFunction('YEAR', static fn(string $date): int => (int)substr($date, 0, 4));
    }
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $this->queries++;
        $query = str_replace(['[PRODIN].[softland].', ' + '], ['', ' || '], $query);
        $query = preg_replace('/CONVERT\(varchar\(10\),\s*([\w.]+),\s*23\)/i', 'DATE($1)', $query);
        $query = preg_replace('/CONVERT\(date,\s*([\w.]+)\)/i', 'DATE($1)', $query);
        $query = preg_replace('/CONVERT\(varchar\((?:80|max)\),\s*([\w.?]+)\)/i', 'CAST($1 AS TEXT)', $query);
        $query = preg_replace('/FROM \(VALUES (.+?)\) c\(CodAux\)/s', 'FROM (SELECT column1 AS CodAux FROM (VALUES $1)) c', $query);
        return parent::prepare($query, $options);
    }
}

final class CobranzaTestDB extends Database
{
    public function fetchAll(string $sql, array $params = []): array
    {
        $stmt = $this->softland()->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
}

$pool = new CobranzaTestPDO();
foreach ([
    'CREATE TABLE usuario (id INTEGER, codigo TEXT, nombre TEXT, area TEXT, is_active INTEGER)',
    'CREATE TABLE usuario_vendedor (usuario_id INTEGER, cod_vendedor TEXT, tipo TEXT)',
    'CREATE TABLE factura_compartida (folio INTEGER, fecha TEXT, porcentaje REAL, cod_vendedor_principal TEXT, cod_vendedor_compartido TEXT, rol TEXT)',
    'CREATE TABLE cwtauxi (CodAux TEXT, RutAux TEXT, NomAux TEXT)',
    'CREATE TABLE cwtauxven (CodAux TEXT, VenCod TEXT)',
    'CREATE TABLE iw_gsaen (CodAux TEXT, CodVendedor TEXT, Fecha TEXT, NroInt INTEGER, Folio INTEGER, Tipo TEXT, Estado TEXT, NomAux TEXT)',
    'CREATE TABLE iw_gmovi (NroInt INTEGER, Tipo TEXT, TotLinea REAL, CodProd TEXT)',
    'CREATE TABLE iw_tprod (CodProd TEXT)',
] as $sql) $pool->exec($sql);
$pool->exec("INSERT INTO usuario VALUES (1,'479','Olga','PRODUCTOS_QUIMICOS',1),(2,'652','Rosangel','PRODUCTOS_QUIMICOS',1),(3,'202','Pedro','PRODUCTOS_QUIMICOS',1),(4,'900','Inactivo','',0)");
$pool->exec("INSERT INTO usuario_vendedor VALUES (1,'479','C'),(2,'652','C'),(3,'202','P'),(4,'900','C')");
$pool->exec("INSERT INTO iw_tprod VALUES ('VALIDO')");
$clientStmt = $pool->prepare('INSERT INTO cwtauxi VALUES (?, ?, ?)');
foreach ([['A','14.156.064-6'], ['B','141560646'], ['N1','76.123.456-k'], ['N2','76123456K'],
    ['R1','99.999.999-9'], ['R2','999999999'], ['100',null], ['200',''], ['CAR','95.441.390-K'], ['NT','11.111.111-1']] as [$code,$rut]) {
    $clientStmt->execute([$code,$rut,"Cliente $code"]);
}
$header = $pool->prepare('INSERT INTO iw_gsaen VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
$line = $pool->prepare('INSERT INTO iw_gmovi VALUES (?, ?, ?, ?)');
$next = 0;
$add = static function (string $code, string $vendor, string $date, float $amount, string $type = 'F', ?int $folio = null) use ($header, $line, &$next): void {
    $next++;
    $header->execute([$code,$vendor,$date,$next,$folio ?? $next,$type,'V',"Cliente $code"]);
    $line->execute([$next,$type,$amount,'VALIDO']);
};
$add('A','202','2024-01-01',250000);
$add('B','479','2026-09-10',250000);
$add('N1','479','2026-09-05',241536,'F',100);
$add('N2','202','2026-09-06',50000);
$add('N1','479','2026-09-09',10000,'N');
$add('N1','479','2026-09-10',20000,'D');
$add('R1','202','2025-01-01',250000);
$add('R1','202','2026-03-01',250000);
$add('R1','479','2026-09-13',241536,'F',300);
$add('R2','202','2025-01-01',250000);
$add('R2','202','2026-08-20',250000);
$add('R2','202','2026-09-01',250000);
$add('100','202','2026-09-07',210000);
$add('200','202','2026-09-07',210000);
$add('CAR','479','2024-10-02',250000);
$add('CAR','479','2026-10-13',241536,'F',400);
$add('NT','202','2026-10-13',150000);
$add('NT','202','2026-10-20',100000);
$pool->exec("INSERT INTO factura_compartida VALUES (100,'2026-09-01',50,'479','652','compartido'),(300,'2026-09-13',50,'479','652','compartido'),(400,'2026-10-13',50,'479','652','compartido')");
$pool->exec("INSERT INTO cwtauxven VALUES ('N1','479'),('R1','479'),('CAR','479'),('100','652'),('NT','202')");
$db = new CobranzaTestDB($pool, []);
$service = new CobranzaService($db, new AnalyticsService($db));
$payload = ['sub' => 10, 'menus' => [['codigo' => 'cobranza_control_clientes']]];
$base = ['desde' => '2026-09-01', 'hasta' => '2026-09-30'];
$checks = 0;
$expect = static function (mixed $actual, mixed $expected, string $name) use (&$checks): void {
    $checks++;
    if ($actual !== $expected) throw new RuntimeException("$name: " . json_encode([$actual, $expected]));
};
$data = $service->route($payload, 'GET', '/control-clientes', $base);
$expect($data['resumen']['clientesNuevos'], 3, 'Un RUT dos codigos; dos fallback separados; historial ajeno invalida nuevo');
$expect($data['resumen']['clientesRecuperados'], 1, 'Recuperado CodAux aunque otro codigo del RUT este activo');
$expect((float)$data['resumen']['ventaNuevos'], 721536.0, 'Venta comercial F/N/D del rango');
$expect($data['recuperados'][0]['codigoCliente'], 'R1', 'Identidad recuperada por CodAux');
$expect($data['recuperados'][0]['reglas'][0]['dias'], 180, 'Ventana central por area');
$expect($data['nuevos'][0]['concurso']['participa'], false, 'Septiembre fuera de concurso');
foreach (['76.123.456-K','76123456-k','76123456K'] as $rut) {
    $filtered = $service->route($payload, 'GET', '/control-clientes', $base + ['rut' => $rut]);
    $expect($filtered['resumen']['clientesNuevos'], 1, 'Filtro RUT normalizado central');
    $expect($filtered['nuevos'][0]['codigoCliente'], 'N1', 'Codigo de captacion original');
    $expect($filtered['nuevos'][0]['cantidadFolios'], 4, 'Folios consolidados sin duplicacion de RUT');
    $expect(array_sum(array_column($filtered['nuevos'][0]['folios'], 'original')), $filtered['nuevos'][0]['ventaTotal'], 'Detalle cuadra con total');
}
foreach ([1,2] as $vendor) {
    $filtered = $service->route($payload, 'GET', '/control-clientes', $base + ['vendedorId' => (string)$vendor]);
    $expect($filtered['resumen']['clientesNuevos'], 1, 'Filtro solo por propiedad, no por venta atribuida');
    $expect($filtered['resumen']['clientesRecuperados'], $vendor === 1 ? 1 : 0, 'Receptor no es propietario del recuperado');
    if ($vendor === 1) $expect(count($filtered['recuperados'][0]['participantes']), 2, 'Participantes compartidos conservados');
    else $expect($filtered['nuevos'][0]['codigoCliente'], '100', 'Propietario encuentra cliente aunque facture otro vendedor');
}
$intersection = $service->route($payload, 'GET', '/control-clientes', $base + ['rut' => '141560646', 'vendedorId' => '2']);
$expect($intersection['resumen']['clientesNuevos'], 0, 'Interseccion Rut/vendedor e historia global');
$partial = $service->route($payload, 'GET', '/control-clientes', ['desde'=>'2026-09-05','hasta'=>'2026-09-06','vendedorId'=>'1']);
$expect($partial['resumen']['clientesNuevos'],1,'Compartida enlazada por mes/folio aun si fecha de asignacion esta fuera del rango');
$expect($partial['nuevos'][0]['participantes'][1]['ventaAsignada'],120768.0,'Atribucion recibida en rango parcial');
$notOwner = $service->route($payload, 'GET', '/control-clientes', $base + ['rut'=>'76123456K','vendedorId'=>'2']);
$expect($notOwner['resumen']['clientesNuevos'],0,'RUT mas vendedor exige propiedad, no participacion compartida');
$expect(array_column($partial['nuevos'][0]['propietarios'],'usuarioId'),[1],'Propietario separado de participantes');
$options = $service->route($payload, 'GET', '/opciones', []);
$expect(array_column($options['vendedores'], 'usuarioId'), [1,3,2], 'Selector dinamico incluye C y excluye inactivo');
$expect(in_array(2024, $options['anios'], true), true, 'Anos historicos disponibles');
$evolution = $service->route($payload, 'GET', '/control-clientes/evolucion', ['anio' => '2026','tipo' => 'nuevos']);
$expect(count($evolution['meses']), 12, 'Evolucion doce meses');
$expect($evolution['meses'][8]['cantidad'], 3, 'Evolucion nuevos por RUT');
$ownerEvolution = $service->route($payload, 'GET', '/control-clientes/evolucion', ['anio'=>'2026','tipo'=>'nuevos','vendedorId'=>'2']);
$expect($ownerEvolution['meses'][8]['cantidad'],1,'Evolucion por propietario');
$expect($ownerEvolution['meses'][8]['venta'],210000.0,'Evolucion no suma venta compartida de cliente ajeno');
foreach ([['desde' => '2026-10-15','hasta' => '2026-10-01'], ['desde' => '2026-02-30'], ['vendedorId' => '4'], ['desde'=>[]], ['rut'=>[]], ['vendedorId'=>[]]] as $invalid) {
    try { $service->route($payload,'GET','/control-clientes',array_replace($base,$invalid)); throw new LogicException('Acepto filtro invalido'); }
    catch (RuntimeException $error) { $expect($error->getCode(),400,'Validacion filtros'); }
}
try { $service->route(['sub' => 10], 'GET', '/opciones', []); throw new LogicException('Acceso sin permiso'); }
catch (RuntimeException $error) { $expect($error->getCode(),403,'Permiso especifico'); }
$oldDir = getenv('CONCURSO_CIERRES_DIR');
putenv('CONCURSO_CIERRES_DIR=' . sys_get_temp_dir() . '/cobranza-test-' . uniqid());
try {
    $october = $service->route($payload,'GET','/control-clientes',['desde'=>'2026-10-01','hasta'=>'2026-10-15']);
    $newClient = $october['nuevos'][0];
    $expect($newClient['ventaTotal'],150000.0,'Venta de rango parcial');
    $expect($newClient['concurso']['califica'],true,'Concurso mensual incluye folio posterior al rango');
    $expect($newClient['concurso']['puntos'],5.0,'Puntos nuevos oficiales');
    $expect($newClient['concurso']['participantes'][0]['ventaCalificadoraMes'],250000.0,'Base mensual separada');
    $carol = $october['recuperados'][0];
    $expect($carol['ventaTotal'],241536.0,'Carol original');
    $expect(array_column($carol['participantes'],'ventaAsignada'),[120768.0,120768.0],'Carol atribucion oficial compartida');
    $expect(array_column($carol['concurso']['participantes'],'puntos'),[1.5,1.5],'Carol puntos oficiales');
    $expect($carol['concurso']['puntos'],3.0,'Carol total tres puntos');
    $expect(array_column($carol['propietarios'],'usuarioId'),[1],'Carol un propietario');
    $expect(array_column($carol['concurso']['participantes'],'usuarioId'),[1,2],'Concurso conserva ambos participantes oficiales');
    $expect(array_column($carol['concurso']['participantes'],'nombre'),['Olga','Rosangel'],'Nombres oficiales independientes del propietario');
    $recipient = $service->route($payload,'GET','/control-clientes',['desde'=>'2026-10-01','hasta'=>'2026-10-15','vendedorId'=>'2']);
    $expect($recipient['resumen']['clientesRecuperados'],0,'Compartida Concurso no transfiere propiedad del recuperado');
} finally {
    putenv($oldDir === false ? 'CONCURSO_CIERRES_DIR' : 'CONCURSO_CIERRES_DIR=' . $oldDir);
}

// 78103135: Claudia propietaria; Olga participa en la venta sin adquirir propiedad.
$pool->exec("INSERT INTO usuario VALUES (5,'454','Claudia Rincones','PRODUCTOS_QUIMICOS',1)");
$pool->exec("INSERT INTO usuario_vendedor VALUES (5,'454','P')");
$clientStmt->execute(['78103135','55.555.555-5','Cliente Claudia']);
$pool->exec("INSERT INTO cwtauxven VALUES ('78103135','454')");
$add('78103135','454','2026-09-15',300000,'F',381156);
$pool->exec("INSERT INTO factura_compartida VALUES (381156,'2026-09-15',50,'454','479','compartido')");
$ownershipService = new CobranzaService($db, new AnalyticsService($db));
$company = $ownershipService->route($payload,'GET','/control-clientes',$base);
$case = array_values(array_filter($company['nuevos'],static fn(array $r): bool => $r['codigoCliente']==='78103135'));
$expect(count($case),1,'78103135 una fila global');
$expect(array_column($case[0]['propietarios'],'nombre'),['Claudia Rincones'],'78103135 propietario desde cwtauxven');
$expect(in_array('Olga',array_column($case[0]['participantes'],'nombre'),true),true,'78103135 compartida conserva participacion Olga');
$claudia = $ownershipService->route($payload,'GET','/control-clientes',$base+['vendedorId'=>'5']);
$expect(array_column($claudia['nuevos'],'codigoCliente'),['78103135'],'78103135 aparece para Claudia');
$olga = $ownershipService->route($payload,'GET','/control-clientes',$base+['vendedorId'=>'1','rut'=>'555555555']);
$expect($olga['resumen']['clientesNuevos'],0,'78103135 no aparece para Olga aunque participa');
echo "OK cobranza: $checks validaciones funcionales en memoria\n";
