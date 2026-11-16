<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }

// Prueba aislada. Nunca carga bootstrap, .env, Softland ni credenciales existentes.
// Por defecto: SQLite en memoria. --mysql: BD temporal en MySQL loopback exclusivamente.
require_once dirname(__DIR__) . '/api/src/Env.php';
$_ENV['CLIENT_SOLICITUD_MAIL_ENABLED'] = 'false';
$_ENV['CLIENT_SOLICITUD_MAIL_TEST_MODE'] = 'false';
date_default_timezone_set('America/Santiago');
final class Database
{
    public function __construct(private PDO $pdo) {}
    public function mysql(): PDO { return $this->pdo; }
}
require_once dirname(__DIR__) . '/api/src/ClienteSolicitudesService.php';

// Trabajadores de concurrencia: solo admiten el nombre aleatorio de una BD de prueba.
if (($argv[1] ?? '') === '--worker') {
    $name = $argv[2] ?? '';
    if (!preg_match('/^gicotex_prospectos_test_[a-f0-9]{12}$/D',$name)) exit(2);
    $workerPdo = new PDO('mysql:host=127.0.0.1;port=' . (int)env('TEST_CLIENTES_MYSQL_PORT',3306) . ';dbname=' . $name . ';charset=utf8mb4',
        (string)env('TEST_CLIENTES_MYSQL_USER','root'),(string)env('TEST_CLIENTES_MYSQL_PASSWORD',''),
        [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_EMULATE_PREPARES=>false]);
    $worker = new ClienteSolicitudesService(new Database($workerPdo));
    while (microtime(true) < (float)($argv[4] ?? 0)) usleep(1000);
    try {
        $tipo = ($argv[5] ?? '') === 'FICHA' ? 'FICHA' : 'PROSPECTO';
        $ficha = [];
        if ($tipo === 'FICHA') foreach (ClienteSolicitudesService::FICHA as $key=>$spec) {
            $format = $spec[3] ?? null;
            $ficha[$key] = is_array($format) ? $format[0] : ($format === 'email' ? 'test@example.test' : ($format === 'url' ? '' : ($spec[2] ? 'TEST' : '')));
        }
        if ($tipo === 'FICHA') $ficha = array_replace($ficha,['origen_canal'=>'GOOGLE_INTERNET','rubro'=>'METALURGICA','forma_pago'=>'CONTADO']);
        $result = $worker->route(['id'=>11,'nombre'=>'Concurrencia','email'=>'test@example.test','perfiles'=>['ventas'],'menus'=>[['codigo'=>'ventas_clientes_prospectos']]],
            'POST',$tipo === 'FICHA' ? '/fichas' : '/prospectos',[],['codigo_vendedor'=>'246','rut_original'=>$argv[3],'razon_social'=>'Concurrencia',
                'contacto_nombre'=>'Test','contacto_email'=>'test@example.test','telefono'=>'123','productos_interes'=>'Test','enviar'=>true,'ficha'=>$ficha]);
        echo json_encode(['status'=>200,'correlativo'=>$result['solicitud']['correlativo']]);
    } catch (Throwable $e) { echo json_encode(['status'=>$e->getCode(),'error'=>$e->getMessage()]); }
    exit;
}

$mysql = in_array('--mysql', $argv, true);
$server = null; $databaseName = null;
if ($mysql) {
    $port = (int)env('TEST_CLIENTES_MYSQL_PORT',3306);
    $server = new PDO('mysql:host=127.0.0.1;port=' . $port . ';charset=utf8mb4',
        (string)env('TEST_CLIENTES_MYSQL_USER','root'), (string)env('TEST_CLIENTES_MYSQL_PASSWORD',''),
        [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
    $databaseName = 'gicotex_prospectos_test_' . bin2hex(random_bytes(6));
    $server->exec('CREATE DATABASE `' . $databaseName . '` CHARACTER SET utf8mb4');
    $pdo = new PDO('mysql:host=127.0.0.1;port=' . $port . ';dbname=' . $databaseName . ';charset=utf8mb4',
        (string)env('TEST_CLIENTES_MYSQL_USER','root'), (string)env('TEST_CLIENTES_MYSQL_PASSWORD',''),
        [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_EMULATE_PREPARES=>false]);
} else {
    $pdo = new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
}

$checks = 0;
$expect = static function ($actual, $expected, string $label) use (&$checks): void {
    $checks++;
    if ($actual !== $expected) throw new RuntimeException($label . ': ' . json_encode([$actual,$expected]));
};
$error = static function (callable $operation, int $status) use ($expect): void {
    try { $operation(); } catch (RuntimeException $e) { $expect($e->getCode(),$status,$e->getMessage()); return; }
    throw new RuntimeException('Se esperaba rechazo HTTP ' . $status);
};

try {
    $pdo->exec('CREATE TABLE usuario_vendedor (usuario_id BIGINT,cod_vendedor VARCHAR(30),tipo CHAR(1))');
    $pdo->exec("INSERT INTO usuario_vendedor VALUES (11,'246','P'),(11,'120','C'),(11,'311','S'),(12,'999','P'),(13,'100','C')");
    $pdo->exec('CREATE TABLE menu (id INTEGER NOT NULL PRIMARY KEY ' . ($mysql ? 'AUTO_INCREMENT' : 'AUTOINCREMENT') . ', codigo VARCHAR(80) UNIQUE,nombre VARCHAR(120),grupo VARCHAR(100),url VARCHAR(255),icono VARCHAR(50),orden INT,activo INT)');
    $pdo->exec('CREATE TABLE perfil (id INTEGER PRIMARY KEY,codigo VARCHAR(80) UNIQUE)');
    $pdo->exec("INSERT INTO perfil VALUES (1,'ventas'),(2,'cobranza'),(3,'administracion'),(4,'admin'),(5,'otro')");
    $pdo->exec('CREATE TABLE perfil_menu (perfil_id INTEGER,menu_id INTEGER,activo INTEGER,PRIMARY KEY (perfil_id,menu_id))');
    $sql = file_get_contents(dirname(__DIR__) . '/database/migrations/crear_solicitudes_clientes_prospectos.sql');
    if ($mysql) {
        // Simula la primera migración ya instalada y verifica su actualización sin perder folios.
        $oldMain = explode(';',$sql)[0];
        $oldMain = str_replace("CASE WHEN estado IN", "CASE WHEN tipo='PROSPECTO' AND estado IN",$oldMain);
        $oldMain = str_replace('uq_cliente_solicitud_rut_activo (tipo,rut_activo)','uq_cliente_solicitud_rut_activo (rut_activo)',$oldMain);
        $oldMain = preg_replace('/\s*ficha_origen_activa BIGINT.*?STORED,/s','',$oldMain);
        $oldMain = preg_replace('/\s*UNIQUE KEY uq_cliente_ficha_origen_activo \(ficha_origen_activa\),/','',$oldMain);
        $pdo->exec($oldMain);
        $pdo->exec('CREATE TABLE cliente_solicitud_secuencia (anio SMALLINT NOT NULL PRIMARY KEY,ultimo BIGINT NOT NULL DEFAULT 0)');
        $pdo->exec('INSERT INTO cliente_solicitud_secuencia VALUES (' . (int)date('Y') . ',41)');
    }
    if (!$mysql) {
        $sql = preg_replace('/-- Actualización compatible.*?(?=CREATE TABLE IF NOT EXISTS cliente_solicitud_ficha)/s','',$sql);
        $sql = preg_replace('/-- Upgrade catálogo:.*?-- Fin upgrade catálogo\./s','',$sql);
        // Traduce únicamente dialecto DDL/UPSERT. Se prueban las columnas e índices del SQL versionado.
        $sql = str_replace('BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY','INTEGER PRIMARY KEY AUTOINCREMENT',$sql);
        $sql = preg_replace('/\bUNSIGNED\b/','',$sql);
        $sql = preg_replace('/ENUM\([^)]*\)/','TEXT',$sql);
        $sql = str_replace(' ON UPDATE CURRENT_TIMESTAMP','',$sql);
        $sql = preg_replace('/\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;/',');',$sql);
        $sql = preg_replace('/UNIQUE KEY (\w+) (\([^)]*\))/','CONSTRAINT $1 UNIQUE $2',$sql);
        $sql = preg_replace('/,\s*KEY \w+ \([^)]*\)/','',$sql);
        $sql = str_replace('ON DUPLICATE KEY UPDATE id = id','ON CONFLICT(email) DO NOTHING',$sql);
        $sql = preg_replace('/ON DUPLICATE KEY UPDATE\s+nombre\s*=\s*VALUES\(nombre\),\s*grupo\s*=\s*VALUES\(grupo\),\s*url\s*=\s*VALUES\(url\),\s*icono\s*=\s*VALUES\(icono\),\s*orden\s*=\s*VALUES\(orden\),\s*activo\s*=\s*VALUES\(activo\)/',
            'ON CONFLICT(codigo) DO UPDATE SET nombre=excluded.nombre,grupo=excluded.grupo,url=excluded.url,icono=excluded.icono,orden=excluded.orden,activo=excluded.activo',$sql);
        $sql = str_replace('ON DUPLICATE KEY UPDATE menu_id=menu_id','WHERE 1 ON CONFLICT(perfil_id,menu_id) DO NOTHING',$sql);
        $sql = str_replace('ON DUPLICATE KEY UPDATE activo=VALUES(activo)','WHERE 1 ON CONFLICT(perfil_id,menu_id) DO UPDATE SET activo=excluded.activo',$sql);
    }
    $migrate = static function () use ($pdo,$sql): void {
        foreach (explode(';',$sql) as $statement) if (trim($statement) !== '') $pdo->exec($statement);
    };
    $migrate();
    if ($mysql) $expect((int)$pdo->query("SELECT ultimo FROM cliente_solicitud_secuencia WHERE tipo='PROSPECTO' AND anio=" . (int)date('Y'))->fetchColumn(),41,'Upgrade conserva secuencia PRO anterior');
    $pdo->exec("UPDATE cliente_solicitud_responsable SET recibe_correo=0 WHERE email='ptapia@texpro.cl'");
    $migrate();
    $expect((int)$pdo->query('SELECT COUNT(*) FROM menu')->fetchColumn(),2,'Menús no se duplican');
    $expect((int)$pdo->query('SELECT COUNT(*) FROM perfil_menu')->fetchColumn(),6,'Herencia de perfiles');
    $expect((int)$pdo->query('SELECT COUNT(*) FROM cliente_solicitud_responsable')->fetchColumn(),2,'Responsables iniciales');
    $expect((int)$pdo->query("SELECT recibe_correo FROM cliente_solicitud_responsable WHERE email='ptapia@texpro.cl'")->fetchColumn(),0,'Reejecución conserva configuración');
    $pdo->exec("UPDATE cliente_solicitud_responsable SET recibe_correo=1 WHERE email='ptapia@texpro.cl'");
    $service = new ClienteSolicitudesService(new Database($pdo));
    $seller = ['id'=>11,'nombre'=>'Vendedor prueba','email'=>'vendedor@example.test','perfiles'=>[['codigo'=>'ventas']],'menus'=>[['codigo'=>'ventas_clientes_prospectos']]];
    $other = array_replace($seller,['id'=>12,'nombre'=>'Otro vendedor']);
    $collector = ['id'=>20,'nombre'=>'Cobranza prueba','perfiles'=>[['codigo'=>'cobranza']],'menus'=>[['codigo'=>'cobranza_clientes_prospectos']]];
    $admin = ['id'=>30,'nombre'=>'Administración prueba','perfiles'=>[['codigo'=>'administracion']],'menus'=>[['codigo'=>'ventas_clientes_prospectos'],['codigo'=>'cobranza_clientes_prospectos']]];
    $call = static fn(array $user,string $method,string $path,array $body=[],array $query=[]) => $service->route($user,$method,$path,$query,$body);
    $expect((int)$pdo->query('SELECT SUM(activo) FROM perfil_menu')->fetchColumn(),4,'Solo cuatro asociaciones iniciales activas');
    $expect((int)$pdo->query("SELECT COUNT(*) FROM menu WHERE nombre='Solicitudes C&P' AND activo=1 AND icono='handshake'")->fetchColumn(),2,'Ambos menús visibles y activos con nombre nuevo');
    $pdo->exec('CREATE TABLE usuario_perfil (usuario_id BIGINT,perfil_id BIGINT,activo INT)');
    $pdo->exec('CREATE TABLE usuario_menu (usuario_id BIGINT,menu_id BIGINT,activo INT)');
    $pdo->exec('ALTER TABLE perfil ADD COLUMN activo INT NOT NULL DEFAULT 1');
    $pdo->exec('INSERT INTO usuario_perfil VALUES (11,1,1),(20,2,1),(30,3,1),(31,4,1)');
    $authSource = file_get_contents(dirname(__DIR__).'/api/src/Services.php');
    $loadStart = strpos($authSource,'private function load_user_menus(');
    $loadSource = substr($authSource,$loadStart,strpos($authSource,'private function ensure_common_menus(',$loadStart)-$loadStart);
    preg_match_all('/fetchAll\(\s*\x27([^\x27]+)\x27\s*,\s*\[\$userId\]/s',$loadSource,$menuQueries);
    $effective = static function (int $id) use ($pdo,$menuQueries): array {
        $rows=[];
        foreach (array_slice($menuQueries[1],0,2) as $query) {$stmt=$pdo->prepare($query);$stmt->execute([$id]);$rows=array_merge($rows,$stmt->fetchAll(PDO::FETCH_ASSOC));}
        return $rows;
    };
    foreach ([30=>'administracion',31=>'admin'] as $userId=>$profile) {
        $authorized=['id'=>$userId,'perfiles'=>[$profile],'menus'=>$effective($userId)];
        $expect($call($authorized,'GET','/contexto')['ok'],true,$profile.' accede Ventas por perfil_menu');
        $expect($call($authorized,'GET','/contexto',[],['ambito'=>'gestion'])['ok'],true,$profile.' accede Cobranza por perfil_menu');
        $error(fn()=>$call(array_replace($authorized,['menus'=>[]]),'GET','/contexto'),403);
    }
    $expect(count($effective(11)),0,'Ventas sin herencia inicial');
    $expect(count($effective(20)),0,'Cobranza sin herencia inicial');
    $error(fn()=>$call(array_replace($seller,['menus'=>$effective(11)]),'GET','/contexto'),403);
    $error(fn()=>$call(array_replace($collector,['menus'=>$effective(20)]),'GET','/contexto',[],['ambito'=>'gestion']),403);
    // Simular el CRUD actual: la concesión por perfil debe sobrevivir otra migración.
    $pdo->exec('UPDATE perfil_menu SET activo=1 WHERE perfil_id IN (1,2)');
    $migrate();
    $expect($call(array_replace($seller,['menus'=>$effective(11)]),'GET','/contexto')['ok'],true,'CRUD perfil habilita Ventas');
    $expect($call(array_replace($collector,['menus'=>$effective(20)]),'GET','/contexto',[],['ambito'=>'gestion'])['ok'],true,'CRUD perfil habilita Cobranza');
    // Simular el upgrade del estado anterior, que sí concedía estos menús por defecto.
    $pdo->exec("UPDATE menu SET nombre='Clientes y Prospectos'");$migrate();
    $expect(count($effective(11)),0,'Upgrade retira herencia anterior de Ventas');
    $expect(count($effective(20)),0,'Upgrade retira herencia anterior de Cobranza');
    $pdo->exec("INSERT INTO usuario_menu SELECT 11,id,1 FROM menu WHERE codigo='ventas_clientes_prospectos'");
    $pdo->exec("INSERT INTO usuario_menu SELECT 20,id,1 FROM menu WHERE codigo='cobranza_clientes_prospectos'");
    $migrate();
    $expect($call(array_replace($seller,['menus'=>$effective(11)]),'GET','/contexto')['ok'],true,'usuario_menu concede Ventas y sobrevive migración');
    $expect($call(array_replace($collector,['menus'=>$effective(20)]),'GET','/contexto',[],['ambito'=>'gestion'])['ok'],true,'usuario_menu concede Cobranza y sobrevive migración');
    $expect((int)$pdo->query('SELECT SUM(activo) FROM perfil_menu')->fetchColumn(),4,'Acceso individual no activa herencia');
    $expect((int)$pdo->query('SELECT COUNT(*) FROM cliente_solicitud_catalogo')->fetchColumn(),13,'Tabla y seeds idempotentes');
    foreach (['ORIGEN'=>7,'RUBRO'=>5,'FORMA_PAGO'=>1] as $tipo=>$count) {
        $expect(count($call($seller,'GET','/catalogos',[],['tipo'=>$tipo])['catalogos']),$count,'Seeds ' . $tipo);
    }
    $cat = $call($admin,'POST','/catalogos',['tipo'=>'ORIGEN','nombre'=>'Árbol / Internet','orden'=>50])['catalogo'];
    $cid = (int)$cat['id'];
    $expect($cat['codigo'],'ARBOL_INTERNET','Genera código normalizado');
    $expect((int)$cat['creado_por'],30,'Auditoría creador');
    $expect($cat['creado_por_nombre'],$admin['nombre'],'Auditoría nombre');
    $collision = $call($admin,'POST','/catalogos',['tipo'=>'ORIGEN','nombre'=>'Árbol / Internet'])['catalogo'];
    $expect($collision['codigo']!==$cat['codigo'],true,'Resuelve colisión sin modificar código previo');
    $call($admin,'DELETE','/catalogos/' . $collision['id']);
    $edited = $call($admin,'PATCH',"/catalogos/$cid",['nombre'=>'Origen editado','orden'=>-1,'activo'=>false])['catalogo'];
    $expect($edited['codigo'],$cat['codigo'],'Código estable al editar nombre');
    $expect((int)$edited['orden'],-1,'Cambia orden');
    $expect(count($call($seller,'GET','/catalogos',[],['tipo'=>'ORIGEN'])['catalogos']),7,'Formulario solo activos');
    $expect(count($call($collector,'GET','/catalogos',[],['tipo'=>'ORIGEN'])['catalogos']),7,'Cobranza puede leer');
    $error(fn()=>$call($collector,'GET','/catalogos',[],['tipo'=>'ORIGEN','todos'=>1]),403);
    foreach ([$collector,$seller] as $denied) {
        $error(fn()=>$call($denied,'POST','/catalogos',['tipo'=>'ORIGEN','nombre'=>'No permitido']),403);
        $error(fn()=>$call($denied,'PATCH',"/catalogos/$cid",['activo'=>true]),403);
        $error(fn()=>$call($denied,'DELETE',"/catalogos/$cid"),403);
    }
    $error(fn()=>$call($admin,'POST','/catalogos',['tipo'=>'INVALIDO','nombre'=>'Test']),422);
    $error(fn()=>$call($admin,'PATCH',"/catalogos/$cid",['codigo'=>'OTRO']),422);
    $call(['id'=>31,'perfiles'=>['admin']],'PATCH',"/catalogos/$cid",['activo'=>true]);
    $expect($call($seller,'GET','/catalogos',[],['tipo'=>'ORIGEN'])['catalogos'][0]['codigo'],$cat['codigo'],'Activa y ordena por orden');
    $call($admin,'DELETE',"/catalogos/$cid");
    $expect(count($call($seller,'GET','/catalogos',[],['tipo'=>'ORIGEN'])['catalogos']),7,'Elimina no usado');
    $pdo->exec("UPDATE cliente_solicitud_catalogo SET nombre='Origen personalizado',activo=0 WHERE codigo='WHATSAPP' AND tipo='ORIGEN'");
    $migrate();
    $seed = $pdo->query("SELECT nombre,activo FROM cliente_solicitud_catalogo WHERE tipo='ORIGEN' AND codigo='WHATSAPP'")->fetch(PDO::FETCH_ASSOC);
    $expect($seed['nombre'],'Origen personalizado','Seed no renombra');$expect((int)$seed['activo'],0,'Seed no reactiva');
    $pdo->exec("UPDATE cliente_solicitud_catalogo SET nombre='WhatsApp',activo=1 WHERE codigo='WHATSAPP' AND tipo='ORIGEN'");
    foreach (['12.345.678-5','12345678-5','123456785'] as $rut) $expect(ClienteSolicitudesService::normalizarRut($rut),'123456785','Normaliza RUT');
    foreach (['14.156.064-6','141560646'] as $rut) $expect(ClienteSolicitudesService::normalizarRut($rut),'141560646','RUT solicitado válido');
    $error(fn()=>ClienteSolicitudesService::normalizarRut('14.156.064-5'),422);
    $error(fn()=>ClienteSolicitudesService::normalizarRut('141'),422);
    $expect(ClienteSolicitudesService::normalizarRut('1.000.005-k'),'1000005K','DV K');
    foreach (['12.345.678-9','abc123456785','0-0','1234567K5','12345678--5'] as $rut) $error(fn()=>ClienteSolicitudesService::normalizarRut($rut),422);
    $context = $call($seller,'GET','/contexto');
    $expect(count($context['vendedores']),3,'Todos los códigos');
    $expect($context['vendedores'][0]['tipo'],'P','Principal por defecto');
    $expect($call(array_replace($seller,['id'=>13]),'GET','/contexto')['vendedores'][0]['cod_vendedor'],'100','Sin principal selecciona primero');
    $error(fn()=>$call(['id'=>40,'perfiles'=>[]],'GET','/mis-solicitudes'),403);
    $error(fn()=>$call($collector,'POST','/prospectos',['codigo_vendedor'=>'246']),403);
    $error(fn()=>$call($seller,'GET','/gestion'),403);
    $error(fn()=>$call($seller,'GET','/resumen',[],['ambito'=>'gestion']),403);
    $error(fn()=>$call($seller,'POST','/prospectos',['codigo_vendedor'=>'999']),403);
    $draft = $call($seller,'POST','/prospectos',['codigo_vendedor'=>'120','usuario_vendedor_id'=>12,'estado'=>'COMPLETADA','correlativo'=>'PRO-FAKE']);
    $id = (int)$draft['solicitud']['id'];
    $expect($draft['solicitud']['estado'],'BORRADOR','Guarda borrador incompleto');
    $expect((int)$draft['solicitud']['usuario_vendedor_id'],11,'No permite suplantar creador');
    $expect($draft['solicitud']['correlativo'],null,'Borrador sin correlativo');
    $expect($draft['correo']['estado'],'no_aplica','Borrador no envía correo');
    $error(fn()=>$call($seller,'POST',"/prospectos/$id/enviar"),422);
    $body = ['codigo_vendedor'=>'311','rut_original'=>'12.345.678-5','razon_social'=>'Cliente de prueba','contacto_nombre'=>'Contacto',
        'contacto_email'=>'contacto@example.test','telefono'=>'+56 9 1111 1111','productos_interes'=>'Productos prueba','observacion_vendedor'=>'Inicial'];
    $saved = $call($seller,'PATCH',"/prospectos/$id",$body);
    $expect($saved['solicitud']['codigo_vendedor'],'311','Código supervisor permitido');
    $sent = $call($seller,'POST',"/prospectos/$id/enviar");
    $correlativo = $sent['solicitud']['correlativo'];
    $expect((bool)preg_match('/^PRO-' . date('Y') . '-\d{5,}$/',$correlativo),true,'Correlativo anual');
    $expect($sent['solicitud']['estado'],'PENDIENTE','BORRADOR a PENDIENTE');
    $expect($sent['correo']['estado'],'omitido','Correo deshabilitado no rompe envío');
    $expect(!empty($sent['solicitud']['enviado_en']),true,'Fecha envío');
    $error(fn()=>$call($seller,'PATCH',"/prospectos/$id",$body),409);
    $error(fn()=>$call($seller,'POST',"/prospectos/$id/enviar"),409);
    foreach (["/prospectos/$id","/$id/historial"] as $path) $error(fn()=>$call($other,'GET',$path),404);
    $error(fn()=>$call($other,'PATCH',"/prospectos/$id",$body),404);
    $error(fn()=>$call($other,'POST',"/prospectos/$id/enviar"),404);
    $expect($call($other,'GET','/mis-solicitudes')['total'],0,'Vendedor no lista ajenos');
    $expect($call($collector,'GET','/gestion')['total'],1,'Cobranza ve global');
    $expect((int)$call($collector,'GET',"/prospectos/$id",[],['ambito'=>'gestion'])['solicitud']['id'],$id,'Detalle global autorizado');
    $error(fn()=>$call($seller,'POST',"/$id/revision"),403);
    $error(fn()=>$call($collector,'POST',"/$id/observar"),422);
    $error(fn()=>$call($collector,'POST',"/$id/completar"),422);
    $expect($call($collector,'POST',"/$id/revision")['solicitud']['estado'],'EN_REVISION','Inicia revisión');
    $error(fn()=>$call($collector,'POST',"/$id/revision"),409);
    $observed = $call($collector,'POST',"/$id/observar",['comentario'=>'Corregir contacto']);
    $expect($observed['solicitud']['estado'],'OBSERVADA','Observa');
    $expect($observed['correo']['estado'],'omitido','Observación sin correo real');
    $error(fn()=>$call($other,'POST','/prospectos',array_replace($body,['codigo_vendedor'=>'999'])),409);
    $resent = $call($seller,'POST',"/prospectos/$id/enviar",['contacto_nombre'=>'Contacto corregido']);
    $expect($resent['solicitud']['estado'],'PENDIENTE','OBSERVADA a PENDIENTE');
    $expect($resent['solicitud']['correlativo'],$correlativo,'Reenvío conserva correlativo');
    $completed = $call($collector,'POST',"/$id/completar",['codigo_auxiliar_softland'=>'AUX-TEST']);
    $expect($completed['solicitud']['estado'],'COMPLETADA','Completar');
    $expect($completed['solicitud']['codigo_auxiliar_softland'],'AUX-TEST','CodAux histórico');
    $expect((int)$completed['solicitud']['procesado_por'],20,'Usuario procesador');
    $expect($completed['solicitud']['procesado_por_nombre'],'Cobranza prueba','Nombre procesador');
    $expect(!empty($completed['solicitud']['completado_en']),true,'Fecha completado');
    $expect($completed['correo']['estado'],'omitido','Completado sin correo real');
    $error(fn()=>$call($collector,'POST',"/$id/observar",['comentario'=>'Otra']),409);
    $error(fn()=>$call($seller,'PATCH',"/prospectos/$id",$body),409);
    $history = $call($seller,'GET',"/$id/historial")['historial'];
    $expect(count($history),8,'Historial conserva cambios');
    $expect($history[5]['comentario'],'Corregir contacto','Comentario histórico');
    $expect(json_decode($history[6]['datos_evento'],true)['campos']['contacto_nombre'],'Contacto corregido','Datos de reenvío históricos');
    $expect(count($call($collector,'GET',"/$id/historial",[],['ambito'=>'gestion'])['historial']),8,'Cobranza consulta historial completo');
    $new = $call($seller,'POST','/prospectos',$body + ['enviar'=>true]);
    $expect($new['solicitud']['correlativo'] !== $correlativo,true,'Correlativo no se reutiliza');
    $newId = (int)$new['solicitud']['id'];
    $error(fn()=>$call($seller,'POST','/prospectos',$body),409);
    $call($collector,'POST',"/$newId/observar",['comentario'=>'Revisar']);
    $expect($call($seller,'PATCH',"/prospectos/$newId",['observacion_vendedor'=>'Guardado parcial'])['solicitud']['estado'],'BORRADOR','Observada permite guardar borrador');
    $expect($call($seller,'POST',"/prospectos/$newId/enviar")['solicitud']['correlativo'],$new['solicitud']['correlativo'],'Conserva correlativo tras guardar borrador');
    $expect($call($seller,'GET','/mis-solicitudes',[],['buscar'=>'123456785'])['total'],2,'Búsqueda RUT normalizado');
    $expect($call($collector,'GET','/gestion',[],['vendedor'=>12])['total'],0,'Filtro vendedor');
    $expect((int)$call($seller,'GET','/resumen')['resumen'][0]['total']>0,true,'Resumen vendedor');
    $error(fn()=>$call($collector,'GET','/responsables'),403);
    $error(fn()=>$call($collector,'POST','/responsables',['nombre'=>'No','email'=>'no@example.test']),403);
    $responsables = $call($admin,'GET','/responsables')['responsables'];
    $expect(count($responsables),2,'Admin lista responsables');
    $expect(count($service->destinatarios()),2,'Ambos destinatarios iniciales');
    $responsableId = (int)$responsables[0]['id'];
    $call($admin,'PATCH','/responsables/' . $responsableId,['recibe_correo'=>false]);
    $expect(count($service->destinatarios()),1,'Respeta recibe_correo');
    $call($admin,'PATCH','/responsables/' . $responsableId,['recibe_correo'=>true,'activo'=>false]);
    $expect(count($service->destinatarios()),1,'Respeta activo');
    $call($admin,'PATCH','/responsables/' . $responsableId,['activo'=>true,'recibe_prospecto'=>false]);
    $expect(count($service->destinatarios()),1,'Respeta recibe_prospecto');
    $call($admin,'POST','/responsables',['nombre'=>'Nuevo','email'=>'nuevo@example.test','recibe_prospecto'=>true,'recibe_correo'=>true,'recibe_ficha'=>true,'activo'=>true]);
    $expect(count($service->destinatarios()),2,'Alta responsable');
    $error(fn()=>$call($admin,'POST','/responsables',['nombre'=>'Duplicado','email'=>'nuevo@example.test']),409);
    $error(fn()=>$call($admin,'POST','/responsables',['nombre'=>'Inválido','email'=>'x']),422);
    $error(fn()=>$call($admin,'DELETE','/responsables/' . $responsableId),404);

    // Sin configurar la bandera también debe omitir correo, aunque Graph no tenga configuración.
    unset($_ENV['CLIENT_SOLICITUD_MAIL_ENABLED']); putenv('CLIENT_SOLICITUD_MAIL_ENABLED');
    $call($collector,'POST',"/$newId/observar",['comentario'=>'Correo omitido por defecto']);
    $expect($call($seller,'POST',"/prospectos/$newId/enviar")['correo']['estado'],'omitido','Correo apagado por defecto');
    foreach (['MAIL_TENANT_ID','MAIL_CLIENT_ID','MAIL_CLIENT_SECRET','MAIL_FROM_ADDRESS'] as $key) $_ENV[$key] = '';
    $_ENV['CLIENT_SOLICITUD_MAIL_ENABLED'] = 'true';
    $call($collector,'POST',"/$newId/observar",['comentario'=>'Prueba fallo controlado de correo']);
    $mailFailure = $call($seller,'POST',"/prospectos/$newId/enviar");
    $expect($mailFailure['solicitud']['estado'],'PENDIENTE','Fallo correo no revierte envío');
    $expect($mailFailure['correo']['estado'],'error','Fallo correo se informa');
    $_ENV['CLIENT_SOLICITUD_MAIL_ENABLED'] = 'false';
$_ENV['CLIENT_SOLICITUD_MAIL_TEST_MODE'] = 'false';
    require_once dirname(__DIR__) . '/api/src/Services.php';
    $recovery = new RecoveryService(new Database($pdo));
    $otpHtml = (new ReflectionMethod($recovery,'build_otp_html'))->invoke($recovery,'123456');
    $expect(str_contains($otpHtml,'123456'),true,'Recovery conserva plantilla OTP');
    $unsafeOtpHtml = (new ReflectionMethod($recovery,'build_otp_html'))->invoke($recovery,'<test>');
    $expect(str_contains($unsafeOtpHtml,'&lt;test&gt;'),true,'Recovery escapa OTP');
    $error(fn()=>(new ReflectionMethod($recovery,'send_otp'))->invoke($recovery,'test@example.test','123456'),500);
    // Ejecutar el send real con transporte sustituido: ninguna llamada HTTP ni correo.
    $graphSource=file_get_contents(dirname(__DIR__).'/api/src/GraphMailService.php');
    $graphSource=substr($graphSource,strpos($graphSource,'final class GraphMailService'));
    $graphSource=str_replace('final class GraphMailService','final class GraphMailErrorFixture',$graphSource);
    $graphSource=substr($graphSource,0,strpos($graphSource,'    private function httpPost('));
    $graphSource.= <<<'PHP'
    public static array $sentRecipients=[];
    private function httpPost(string $url,string $body,array $headers): array {
        if (str_contains($url,'/token')) return ['status'=>200,'body'=>'{"access_token":"TOKEN_FICTICIO"}'];
        self::$sentRecipients=json_decode($body,true)['message']['toRecipients'];
        return ['status'=>503,'body'=>'FALLO_SIMULADO'];
    }
}
PHP;
    eval($graphSource);
    foreach (['MAIL_TENANT_ID','MAIL_CLIENT_ID','MAIL_CLIENT_SECRET','MAIL_FROM_ADDRESS'] as $key) $_ENV[$key]='LOCAL_FIXTURE';
    $_ENV['CLIENT_SOLICITUD_MAIL_TEST_MODE']='true';
    try {
        $error(fn()=>(new GraphMailErrorFixture())->send(['test@example.test'],'OTP ficticio',$otpHtml),500);
        $expect(GraphMailErrorFixture::$sentRecipients,[['emailAddress'=>['address'=>'test@example.test']]],'Transporte conserva destinatario aunque C&P esté en modo TEST');
    } finally {
        foreach (['MAIL_TENANT_ID','MAIL_CLIENT_ID','MAIL_CLIENT_SECRET','MAIL_FROM_ADDRESS'] as $key) $_ENV[$key]='';
        $_ENV['CLIENT_SOLICITUD_MAIL_TEST_MODE']='false';
    }
    require_once dirname(__DIR__) . '/src/modulo/varios/login/return-url.php';
    foreach (['ventas','cobranza'] as $area) {
        $return = '/src/modulo/' . $area . '/clientes-prospectos/index.html?solicitud=123';
        $expect(clientes_prospectos_return_url($return),$return,'Login conserva enlace original de solicitud');
    }
    foreach (['https://example.test/','//example.test/','/\\example.test/',"/src/modulo/ventas/clientes-prospectos/index.html\r\nX:1",'/src/modulo/ventas/clientes-prospectos/index.html?x=</script>','/api/auth/logout',[]] as $return) {
        $expect(clientes_prospectos_return_url($return),'','Login rechaza retorno externo o inválido');
    }
    // Ejecuta la pantalla PHP real con una respuesta de autenticación ficticia y sin bootstrap/.env.
    $loginSource = file_get_contents(dirname(__DIR__) . '/src/modulo/varios/login/index.php');
    $fakeAuth = <<<'PHP'
final class Database {}
final class AuthService {
    public function __construct($db) {}
    public function login($user,$password) { return ['token'=>'TOKEN_FICTICIO','user'=>['area'=>'','vendedores'=>[['cod_vendedor'=>'246','tipo'=>'P']],'perfiles'=>[['codigo'=>'ventas']],'menus'=>[['url'=>'/src/modulo/ventas/clientes-prospectos/index.html','orden'=>-100],['url'=>'/src/modulo/ventas/dashboard/index.html','orden'=>99]]]]; }
}
function set_auth_cookie($token) {}
function clear_auth_cookie() {}
PHP;
    $loginSource = str_replace("require_once __DIR__ . '/../../../../api/bootstrap.php';",$fakeAuth,$loginSource);
    $loginSource = str_replace("require_once __DIR__ . '/return-url.php';",'require_once ' . var_export(dirname(__DIR__) . '/src/modulo/varios/login/return-url.php',true) . ';',$loginSource);
    foreach ([
        '',
        '/src/modulo/ventas/clientes-prospectos/index.html?solicitud=123',
        '/src/modulo/cobranza/clientes-prospectos/index.html?solicitud=456',
        'https://example.test/', '/src/modulo/ventas/clientes-prospectos/index.html?x=</script>',
    ] as $return) {
        $fixture = tempnam(sys_get_temp_dir(),'gicotex-login-');
        try {
            $setup = '$_SERVER["REQUEST_METHOD"]="POST"; $_GET=[]; $_POST=' . var_export(['usuario'=>'FICTICIO','password'=>'FICTICIO','returnUrl'=>$return],true) . ';';
            file_put_contents($fixture,str_replace('declare(strict_types=1);','declare(strict_types=1);' . $setup,$loginSource));
            $pipes = [];
            $child = proc_open([PHP_BINARY,$fixture],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
            if (!is_resource($child)) throw new RuntimeException('No se pudo iniciar fixture de login.');
            fclose($pipes[0]);$html = stream_get_contents($pipes[1]);$stderr = stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);
            $expect(proc_close($child),0,'Login PHP renderiza sin errores: ' . $stderr);
            if (!preg_match('/const payload = (.*?);/s',$html,$match)) throw new RuntimeException('Login no generó payload.');
            $payload = json_decode($match[1],true,512,JSON_THROW_ON_ERROR);
            $expect($payload['redirect'],clientes_prospectos_return_url($return) ?: '/src/modulo/ventas/dashboard/index.html','Login exitoso vuelve al enlace original o al destino habitual seguro');
        } finally { if (is_file($fixture)) unlink($fixture); }
    }
    // Probar el resolver real sin ejecutar el bootstrap ni autenticar usuarios reales.
    $functions = substr($loginSource,strpos($loginSource,'function normalize_login_area('));
    $functions = substr($functions,0,strpos($functions,'$authService ='));
    eval($functions);
    $salesDashboard=['url'=>'/src/modulo/ventas/dashboard/index.html','orden'=>999];
    $cpMenu=['url'=>'/src/modulo/ventas/clientes-prospectos/index.html','orden'=>-999];
    foreach (['','ventas','Vendedores','Comercial'] as $area) {
        $expect(resolve_login_route(['area'=>$area,'vendedores'=>[['cod_vendedor'=>'246']],'menus'=>[$cpMenu,$salesDashboard]]),$salesDashboard['url'],'Login vendedor prioriza Dashboard con área '.$area);
    }
    foreach (['gerencia'=>'/src/modulo/gerencia/dashboard-comercial/index.html','produccion'=>'/src/modulo/produccion/produccion/index.html','rrhh'=>'/src/modulo/rrhh/rrhh/index.html','cobranza'=>'/src/modulo/contabilidad/contabilidad/index.html','administracion'=>'/src/modulo/admin/admin/index.html'] as $area=>$url) {
        $expect(resolve_login_route(['area'=>$area,'menus'=>[$cpMenu,$salesDashboard,['url'=>$url,'orden'=>1000]]]),$url,'Conserva destino de '.$area);
        $expect(resolve_login_route(['area'=>$area,'menus'=>[$cpMenu,$salesDashboard]]),$cpMenu['url'],'Conserva fallback sin menú preferido de '.$area);
    }
    $expect(resolve_login_route(['area'=>'desconocida','menus'=>[$cpMenu]]),$cpMenu['url'],'Sin Dashboard conserva fallback previo');
    $expect(resolve_login_route(['menus'=>[]]),'/src/modulo/varios/sin-acceso/index.html','Sin menús conserva sin acceso');
    $supportDashboard=['url'=>'/src/modulo/soporte-ti/dashboard/index.html','orden'=>1];
    foreach ([[],[['cod_vendedor'=>' ']]] as $codes) {
        $expect(resolve_login_route(['area'=>'soporte-ti','perfiles'=>[['codigo'=>'soporte-ti']],'vendedores'=>$codes,'menus'=>[$supportDashboard,$salesDashboard]]),$supportDashboard['url'],'Soporte sin código vendedor conserva su inicio aunque tenga acceso a Ventas');
    }
    $expect(resolve_login_route(['area'=>'soporte-ti','vendedores'=>[['cod_vendedor'=>'246']],'menus'=>[$supportDashboard,$salesDashboard]]),$salesDashboard['url'],'Código asociado identifica vendedor real');
    $expect($pdo->inTransaction(),false,'Transacciones cerradas');
    // Ficha 1:1 y permisos efectivos de ambos menús.
    $error(fn()=>$call(array_replace($seller,['menus'=>[]]),'GET','/mis-solicitudes'),403);
    $direct = array_replace($collector,['perfiles'=>[]]);
    $expect($call($direct,'GET','/gestion')['total'],2,'usuario_menu Cobranza sin perfil');
    $error(fn()=>$call(array_replace($direct,['menus'=>[['codigo'=>'cobranza_clientes_prospectos','activo'=>false]]]),'GET','/gestion'),403);
    $expect($call(array_replace($seller,['perfiles'=>[]]),'GET','/mis-solicitudes')['total'],2,'usuario_menu Ventas sin perfil');
    $fichaInput = [];
    foreach (ClienteSolicitudesService::FICHA as $key=>$spec) {
        $format = $spec[3] ?? null;
        $fichaInput[$key] = is_array($format) ? $format[0] : ($format === 'email' ? 'test@example.test' : ($format === 'url' ? 'https://example.test' : ($spec[2] ? 'Prueba' : '')));
    }
    $fichaInput = array_replace($fichaInput,['origen_canal'=>'GOOGLE_INTERNET','rubro'=>'METALURGICA','forma_pago'=>'CONTADO']);
    $beforePreview = (int)$pdo->query('SELECT COUNT(*) FROM cliente_solicitud')->fetchColumn();
    $lookup = $call($seller,'GET','/fichas/buscar-rut',[],['rut'=>'123456785']);
    $expect((int)$lookup['prospecto_completado']['id'],$id,'Detecta Prospecto completado propio');
    $expect($lookup['existe_activa'],false,'Sin Ficha activa antes de crear');
    $expect((int)$pdo->query('SELECT COUNT(*) FROM cliente_solicitud')->fetchColumn(),$beforePreview,'Consultar/precargar no crea solicitud');
    $error(fn()=>$call($collector,'GET','/fichas/buscar-rut',[],['rut'=>'123456785']),403);
    $derived = $call($seller,'POST','/fichas',['solicitud_origen_id'=>$id]);
    $fid = (int)$derived['solicitud']['id'];
    $expect($derived['solicitud']['tipo'],'FICHA','Crea Ficha desde Prospecto');
    $expect((int)$derived['solicitud']['solicitud_origen_id'],$id,'Origen histórico');
    foreach (['rut_original','razon_social','contacto_nombre','contacto_email','telefono','productos_interes','codigo_vendedor','vendedor_nombre','codigo_auxiliar_softland'] as $key) {
        $expect($derived['solicitud'][$key],$completed['solicitud'][$key],'Precarga ' . $key);
    }
    foreach (['encargado_compras'=>'contacto_nombre','email_compras'=>'contacto_email','telefono_compras'=>'telefono','linea_productos'=>'productos_interes'] as $key=>$sourceKey) $expect($derived['solicitud']['ficha'][$key],$completed['solicitud'][$sourceKey],'Precarga de Ficha: ' . $key);
    $expect($derived['solicitud']['correlativo'],null,'Borrador Ficha sin correlativo');
    $error(fn()=>$call($seller,'POST','/fichas',['solicitud_origen_id'=>$id]),409);
    $lookup = $call($seller,'GET','/fichas/buscar-rut',[],['rut'=>'123456785']);
    $expect((int)$lookup['solicitud']['id'],$fid,'Devuelve Ficha activa propia para abrir');
    $otherLookup = $call($other,'GET','/fichas/buscar-rut',[],['rut'=>'123456785']);
    $expect($otherLookup['existe_activa'],true,'Detecta duplicado global');
    $expect($otherLookup['solicitud'],null,'No expone ID ni detalle de Ficha ajena');
    $expect($otherLookup['prospecto_completado'],null,'No expone origen ajeno');
    try {
        $pdo->exec("INSERT INTO cliente_solicitud (tipo,estado,usuario_vendedor_id,vendedor_nombre,vendedor_email,codigo_vendedor,solicitud_origen_id,rut_normalizado) VALUES ('FICHA','BORRADOR',11,'TEST','test@example.test','246',$id,'222222222')");
        throw new RuntimeException('El índice de origen debió impedir el duplicado.');
    } catch (PDOException $e) { $expect(str_contains($e->getMessage(),'ficha_origen'),true,'MySQL/SQLite protege origen incluso con otro RUT'); }
    $error(fn()=>$call($other,'POST','/fichas',['solicitud_origen_id'=>$id]),404);
    $error(fn()=>$call($seller,'POST','/fichas',['solicitud_origen_id'=>$newId]),409);
    $error(fn()=>$call($seller,'PATCH',"/fichas/$fid",['rut_original'=>'11111111-1']),422);
    $error(fn()=>$call($seller,'PATCH',"/fichas/$fid",['ficha'=>['observacion_cobranza'=>'Suplantación']]),403);
    $error(fn()=>$call($seller,'POST',"/fichas/$fid/enviar"),422);
    $error(fn()=>$call($seller,'PATCH',"/fichas/$fid",['codigo_vendedor'=>'999','ficha'=>$fichaInput]),403);
    $call($seller,'PATCH',"/fichas/$fid",['codigo_vendedor'=>'120','ficha'=>array_replace($fichaInput,['direccion_despacho'=>''])]);
    $error(fn()=>$call($seller,'POST',"/fichas/$fid/enviar"),422);
    $call($seller,'PATCH',"/fichas/$fid",['ficha'=>$fichaInput]);
    $fsent = $call($seller,'POST',"/fichas/$fid/enviar");
    $expect($fsent['solicitud']['correlativo'],'CLI-' . date('Y') . '-00001','Secuencia CLI independiente');
    $expect($fsent['solicitud']['ficha']['giro'],'Prueba','Guarda campos de cliente');
    $expect($fsent['solicitud']['codigo_vendedor'],'120','Ficha permite cambiar a otro código propio');
    $expect($fsent['solicitud']['ficha']['telefono_compras'],'','Teléfono compras opcional');
    $expect((int)$pdo->query("SELECT COUNT(*) FROM cliente_solicitud WHERE rut_normalizado='123456785' AND estado='PENDIENTE'")->fetchColumn(),2,'Prospecto y Ficha coexisten');
    $error(fn()=>$call($seller,'POST','/fichas',$body+['ficha'=>$fichaInput]),409);
    $error(fn()=>$call($other,'GET',"/fichas/$fid"),404);
    $error(fn()=>$call($other,'PATCH',"/fichas/$fid",['ficha'=>$fichaInput]),404);
    $error(fn()=>$call($collector,'POST',"/$fid/observar"),422);
    $call($collector,'POST',"/$fid/revision");
    $call($collector,'POST',"/$fid/observar",['comentario'=>'Corregir giro']);
    $call($seller,'PATCH',"/fichas/$fid",['ficha'=>['giro'=>'Giro corregido']]);
    $fresent = $call($seller,'POST',"/fichas/$fid/enviar");
    $expect($fresent['solicitud']['correlativo'],$fsent['solicitud']['correlativo'],'Reenvía Ficha con mismo correlativo');
    $error(fn()=>$call($collector,'POST',"/$fid/completar"),422);
    $fcompleted = $call($collector,'POST',"/$fid/completar",['codigo_auxiliar_softland'=>'AUX-FICHA','ficha_interna'=>[
        'cliente_clasificacion_interna'=>'Cliente Nuevo','ultima_compra'=>'2026-10-20','mes_creacion'=>'2026-11',
        'correlativo_interno'=>'LOCAL-1','observacion_cobranza'=>'Validación local']]);
    $expect($fcompleted['solicitud']['estado'],'COMPLETADA','Completa Ficha');
    $expect($fcompleted['solicitud']['ficha']['observacion_cobranza'],'Validación local','Guarda campos internos');
    $expect(isset($call($seller,'GET',"/fichas/$fid")['solicitud']['ficha']['observacion_cobranza']),false,'Datos internos ocultos para Ventas');
    $expect(str_contains(json_encode($call($seller,'GET',"/$fid/historial")),'Validación local'),false,'Historial vendedor oculta campos internos');
    $expect((int)$pdo->query("SELECT COUNT(*) FROM cliente_solicitud_historial WHERE solicitud_id=$fid AND accion='FICHA_CREADA_DESDE_PROSPECTO'")->fetchColumn(),1,'Historial de origen');
    foreach (['FICHA_BORRADOR_CREADA','FICHA_BORRADOR_ACTUALIZADA','FICHA_ENVIADA','REENVIADA','COMPLETADA'] as $action) {
        $stmt=$pdo->prepare('SELECT COUNT(*) FROM cliente_solicitud_historial WHERE solicitud_id=? AND accion=?');$stmt->execute([$fid,$action]);
        $expect((int)$stmt->fetchColumn()>0,true,'Historial ' . $action);
    }
    $directBody = array_replace($body,['rut_original'=>'11111111-1','ficha'=>$fichaInput]);
    foreach (['contacto_nombre','contacto_email','telefono','productos_interes'] as $key) unset($directBody[$key]);
    $directFicha = $call($seller,'POST','/fichas',$directBody);
    $did = (int)$directFicha['solicitud']['id'];
    $expect($directFicha['solicitud']['solicitud_origen_id'],null,'Ficha directa sin origen');
    $expect($directFicha['solicitud']['contacto_nombre'],$fichaInput['encargado_compras'],'Ficha directa usa contacto de compras');
    $error(fn()=>$call($seller,'POST','/fichas',$directBody),409);
    $error(fn()=>$call($seller,'POST',"/fichas/$did/enviar",['ficha'=>['rubro'=>'Otros','rubro_otro'=>'']]),422);
    $directSent = $call($seller,'POST',"/fichas/$did/enviar",['ficha'=>['rubro'=>'Otros','rubro_otro'=>'Textil']]);
    $expect($directSent['solicitud']['correlativo'],'CLI-' . date('Y') . '-00002','Segundo correlativo CLI');
    $expect($call($collector,'GET','/gestion',[],['tipo'=>'FICHA'])['total'],2,'Filtro tipo Ficha');
    $expect($call($seller,'GET','/mis-solicitudes',[],['tipo'=>'PROSPECTO'])['total'],2,'Filtro tipo Prospecto');
    $listed = $call($seller,'GET','/mis-solicitudes',[],['tipo'=>'FICHA'])['solicitudes'];
    $derivedListed = array_values(array_filter($listed,static fn($item)=>(int)$item['id']===$fid))[0];
    $expect($derivedListed['origen_correlativo'],$correlativo,'Listado muestra origen PRO');
    $again = $call($seller,'POST','/fichas',['solicitud_origen_id'=>$id]);
    $expect($again['solicitud']['estado'],'BORRADOR','Puede derivar otra Ficha tras completar la anterior');
    $usedOrigin = $pdo->query("SELECT id FROM cliente_solicitud_catalogo WHERE tipo='ORIGEN' AND codigo='GOOGLE_INTERNET'")->fetchColumn();
    $call($admin,'PATCH','/catalogos/'.$usedOrigin,['nombre'=>'Google Ads / Internet','activo'=>false]);
    $snapshot = $call($seller,'GET',"/fichas/$fid")['solicitud']['ficha'];
    $expect($snapshot['origen_codigo'],'GOOGLE_INTERNET','Referencia estable');
    $expect($snapshot['origen_canal'],'Google / Internet','Snapshot preservado al renombrar');
    $error(fn()=>$call($admin,'DELETE','/catalogos/'.$usedOrigin),409);
    $error(fn()=>$call($seller,'PATCH','/fichas/'.$again['solicitud']['id'],['ficha'=>['origen_canal'=>'GOOGLE_INTERNET']]),422);
    $call($admin,'PATCH','/catalogos/'.$usedOrigin,['activo'=>true]);
    // Reejecutar migración conserva exactamente los textos de una ficha antigua.
    $legacyId = (int)$again['solicitud']['id'];
    $pdo->exec("UPDATE cliente_solicitud_ficha SET origen_canal='Canal antiguo libre',rubro='Metalúrgica',forma_pago='CONTADO',origen_codigo=NULL,rubro_codigo=NULL,forma_pago_codigo=NULL WHERE solicitud_id=$legacyId");
    $migrate();
    $legacy = $call($seller,'GET',"/fichas/$legacyId")['solicitud']['ficha'];
    foreach (['origen_canal'=>'Canal antiguo libre','rubro'=>'Metalúrgica','forma_pago'=>'CONTADO','rubro_codigo'=>'METALURGICA','forma_pago_codigo'=>'CONTADO'] as $key=>$value) $expect($legacy[$key],$value,'Migración conserva/completa '.$key);
    $expect($legacy['origen_codigo'],null,'No inventa referencia para texto desconocido');
    $resaved = $call($seller,'PATCH',"/fichas/$legacyId",['ficha'=>['giro'=>'Editado']])['solicitud']['ficha'];
    $expect($resaved['origen_canal'],'Canal antiguo libre','Editar ficha antigua conserva origen');
    $usageCat = $call($admin,'POST','/catalogos',['tipo'=>'ORIGEN','nombre'=>'Uso permanente'])['catalogo'];
    $call($seller,'PATCH',"/fichas/$legacyId",['ficha'=>['origen_canal'=>$usageCat['codigo']]]);
    $call($seller,'PATCH',"/fichas/$legacyId",['ficha'=>['origen_canal'=>'WHATSAPP']]);
    $error(fn()=>$call($admin,'DELETE','/catalogos/'.$usageCat['id']),409);
    $allOrigins = $call($admin,'GET','/catalogos',[],['tipo'=>'ORIGEN','todos'=>1])['catalogos'];
    $usedRow = array_values(array_filter($allOrigins,fn($r)=>$r['id']===$usageCat['id']))[0];
    $expect((int)$usedRow['puede_eliminar'],0,'Uso anterior sigue impidiendo eliminar tras cambiar selección');
    // Snapshots de los tres catálogos sobreviven renombres y una edición posterior de ficha.
    $historicalDraft = $call($seller,'PATCH',"/fichas/$legacyId",['ficha'=>['origen_canal'=>'GOOGLE_INTERNET','rubro'=>'METALURGICA','forma_pago'=>'CONTADO']])['solicitud']['ficha'];
    foreach (['ORIGEN'=>['origen_canal','origen_codigo'],'RUBRO'=>['rubro','rubro_codigo'],'FORMA_PAGO'=>['forma_pago','forma_pago_codigo']] as $tipo=>[$field,$codeField]) {
        $catalogId = $pdo->query("SELECT id FROM cliente_solicitud_catalogo WHERE tipo='$tipo' AND codigo='".$historicalDraft[$codeField]."'")->fetchColumn();
        $call($admin,'PATCH','/catalogos/'.$catalogId,['nombre'=>'Nombre nuevo '.$tipo,'activo'=>false]);
        $error(fn()=>$call($admin,'DELETE','/catalogos/'.$catalogId),409);
        $unchanged = $call($seller,'PATCH',"/fichas/$legacyId",['ficha'=>[$field=>$historicalDraft[$codeField]]])['solicitud']['ficha'];
        $expect($unchanged[$field],$historicalDraft[$field],'Snapshot intacto '.$tipo);
        $expect($unchanged[$codeField],$historicalDraft[$codeField],'Referencia intacta '.$tipo);
        $call($admin,'PATCH','/catalogos/'.$catalogId,['nombre'=>$historicalDraft[$field],'activo'=>true]);
    }
    $othersId = $pdo->query("SELECT id FROM cliente_solicitud_catalogo WHERE tipo='RUBRO' AND codigo='OTROS'")->fetchColumn();
    $call($admin,'PATCH','/catalogos/'.$othersId,['nombre'=>'Otro sector']);
    $error(fn()=>$call($seller,'POST',"/fichas/$legacyId/enviar",['ficha'=>array_replace($fichaInput,['rubro'=>'OTROS','rubro_otro'=>''])]),422);
    $call($admin,'PATCH','/catalogos/'.$othersId,['nombre'=>'Otros']);
    $a = $call($admin,'POST','/catalogos',['tipo'=>'RUBRO','nombre'=>'AAA orden','orden'=>-50])['catalogo'];
    $z = $call($admin,'POST','/catalogos',['tipo'=>'RUBRO','nombre'=>'ZZZ orden','orden'=>-50])['catalogo'];
    $ordered = $call($seller,'GET','/catalogos',[],['tipo'=>'RUBRO'])['catalogos'];
    $expect(array_column(array_slice($ordered,0,2),'codigo'),[$a['codigo'],$z['codigo']],'Orden por orden y nombre');
    $call($admin,'DELETE','/catalogos/'.$a['id']);$call($admin,'DELETE','/catalogos/'.$z['id']);
    $call($admin,'PATCH','/responsables/' . $responsableId,['activo'=>true,'recibe_correo'=>true,'recibe_ficha'=>false,'recibe_prospecto'=>true]);
    $expect(count($service->destinatarios('FICHA')),2,'Respeta recibe_ficha');
    $_ENV['CLIENT_SOLICITUD_MAIL_TEST_MODE'] = 'true';
    $_ENV['CLIENT_SOLICITUD_MAIL_TEST_RECIPIENT'] = 'arivera@texpro.cl';
    foreach ([$completed['solicitud'],$fcompleted['solicitud']] as $mailRow) foreach (['enviar','observar','completar'] as $event) {
        $mail = $service->prepararCorreo($mailRow,$event);
        $expect($mail['destinatarios'],['arivera@texpro.cl'],'TEST fuerza destinatario único');
        $expect(str_starts_with($mail['asunto'],'[LOCAL TEST] '),true,'Asunto LOCAL TEST');
        $expect(str_contains($mail['html'],'Destinatario lógico original:'),true,'Incluye destino lógico');
        $expect(count($mail['destinatarios_logicos'])>0,true,'Conserva destinatarios lógicos');
    }
    $_ENV['CLIENT_SOLICITUD_MAIL_TEST_RECIPIENT'] = 'otro@example.test';
    $error(fn()=>$service->prepararCorreo($completed['solicitud'],'enviar'),422);
    $_ENV['CLIENT_SOLICITUD_MAIL_TEST_MODE'] = 'false';
    $preservedPros = $pdo->query("SELECT id,correlativo,estado,rut_normalizado FROM cliente_solicitud WHERE tipo='PROSPECTO' ORDER BY id")->fetchAll(PDO::FETCH_ASSOC);
    $preservedHistory = $pdo->query("SELECT h.* FROM cliente_solicitud_historial h JOIN cliente_solicitud s ON s.id=h.solicitud_id WHERE s.tipo='PROSPECTO' ORDER BY h.id")->fetchAll(PDO::FETCH_ASSOC);
    $migrate();
    $expect($pdo->query("SELECT id,correlativo,estado,rut_normalizado FROM cliente_solicitud WHERE tipo='PROSPECTO' ORDER BY id")->fetchAll(PDO::FETCH_ASSOC),$preservedPros,'Reaplicar migración conserva Prospectos y correlativos');
    $expect($pdo->query("SELECT h.* FROM cliente_solicitud_historial h JOIN cliente_solicitud s ON s.id=h.solicitud_id WHERE s.tipo='PROSPECTO' ORDER BY h.id")->fetchAll(PDO::FETCH_ASSOC),$preservedHistory,'Reaplicar migración conserva historial de Prospectos');
    if ($mysql) {
        $parallel = static function (array $ruts, string $tipo = 'PROSPECTO') use ($databaseName): array {
            $processes = []; $start = microtime(true) + 0.5;
            foreach ($ruts as $rut) {
                $pipes = [];
                $process = proc_open([PHP_BINARY,__FILE__,'--worker',$databaseName,$rut,(string)$start,$tipo],
                    [0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
                if (!is_resource($process)) throw new RuntimeException('No se pudo iniciar trabajador.');
                fclose($pipes[0]);
                $processes[] = [$process,$pipes];
            }
            $results = [];
            foreach ($processes as [$process,$pipes]) {
                $output = stream_get_contents($pipes[1]); $errors = stream_get_contents($pipes[2]);
                fclose($pipes[1]); fclose($pipes[2]);
                if (proc_close($process) !== 0) throw new RuntimeException('Falló trabajador: ' . $errors);
                $results[] = json_decode($output,true,512,JSON_THROW_ON_ERROR);
            }
            return $results;
        };
        $results = $parallel(['11111111-1','22222222-2']);
        $expect(array_column($results,'status'),[200,200],'Envíos simultáneos');
        $expect(count(array_unique(array_column($results,'correlativo'))),2,'Correlativos concurrentes únicos');
        $results = $parallel(['1000005-K','1000005-K']);
        $statuses = array_column($results,'status'); sort($statuses);
        $expect($statuses,[200,409],'RUT concurrente permite solo una solicitud');
        $results = $parallel(['22222222-2','33333333-3'],'FICHA');
        $expect(array_column($results,'status'),[200,200],'Fichas simultáneas');
        $expect(count(array_unique(array_column($results,'correlativo'))),2,'Correlativos CLI concurrentes únicos');
        $results = $parallel(['1000005-K','1000005-K'],'FICHA');
        $statuses = array_column($results,'status'); sort($statuses);
        $expect($statuses,[200,409],'RUT Ficha concurrente protegido');
    }
    echo "OK: $checks verificaciones (" . ($mysql ? 'MySQL, migración original' : 'SQLite, migración adaptada al dialecto') . "). Sin Softland ni correo real.\n";
} finally {
    $pdo = null;
    if ($server && $databaseName && preg_match('/^gicotex_prospectos_test_[a-f0-9]{12}$/D',$databaseName)) {
        $server->exec('DROP DATABASE `' . $databaseName . '`');
    }
}
