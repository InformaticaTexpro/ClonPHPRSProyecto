<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require_once dirname(__DIR__) . '/api/src/Env.php';
require_once dirname(__DIR__) . '/api/src/Database.php';
require_once dirname(__DIR__) . '/api/src/ClienteSolicitudesService.php';
load_env_file(dirname(__DIR__) . '/.env');
if (!in_array(env('DB_HOST',''),['127.0.0.1','localhost'],true) || env('DB_NAME','') !== 'bdtexpro') {
    fwrite(STDERR,"Prueba permitida únicamente en bdtexpro LOCAL.\n"); exit(1);
}
$missing = [];
foreach (['MAIL_TENANT_ID','MAIL_CLIENT_ID','MAIL_CLIENT_SECRET','MAIL_FROM_ADDRESS'] as $key) if (trim((string)env($key,'')) === '') $missing[] = $key;
if ($missing) { echo 'EMAIL NO EJECUTADO. Faltan: ' . implode(', ',$missing) . "\n"; exit(0); }
// Fuerza el destino en memoria, incluso si alguien cambia posteriormente el .env.
$_ENV['CLIENT_SOLICITUD_MAIL_ENABLED'] = 'true';
$_ENV['CLIENT_SOLICITUD_MAIL_TEST_MODE'] = 'true';
$_ENV['CLIENT_SOLICITUD_MAIL_TEST_RECIPIENT'] = 'arivera@texpro.cl';
$_ENV['FRONTEND_URL'] = 'http://localhost:8000';
date_default_timezone_set('America/Santiago');
$database = new Database();
$service = new ClienteSolicitudesService($database);
$pdo = $database->mysql();
$pdo->beginTransaction();
$failures = 0;
try {
    // Eventos temporales para comprobar el comentario del email; se revierten al terminar.
    $stmt = $pdo->prepare("INSERT INTO cliente_solicitud_historial (solicitud_id,accion,estado_nuevo,usuario_id,usuario_nombre,comentario) VALUES (0,'OBSERVADA','OBSERVADA',0,'LOCAL TEST',?)");
    $stmt->execute(['Comentario de prueba LOCAL. No corresponde a una solicitud real.']);
    $types = in_array('--fichas',$argv,true) ? ['FICHA'=>'CLI'] : ['PROSPECTO'=>'PRO','FICHA'=>'CLI'];
    foreach ($types as $tipo=>$prefix) foreach (['enviar','observar','completar'] as $event) {
        $row = ['id'=>0,'tipo'=>$tipo,'correlativo'=>$prefix . '-' . date('Y') . '-LOCAL-TEST',
            'vendedor_email'=>'vendedor-logico@example.test','vendedor_nombre'=>'Prueba LOCAL GICOTEX',
            'codigo_vendedor'=>'TEST','razon_social'=>'CLIENTE DE PRUEBA LOCAL','rut_original'=>'12.345.678-5',
            'codigo_auxiliar_softland'=>'AUX-LOCAL-TEST'];
        try {
            $mail = $service->prepararCorreo($row,$event);
            if ($mail['destinatarios'] !== ['arivera@texpro.cl']) throw new RuntimeException('Destino TEST inválido.');
            if (in_array('--preview',$argv,true)) {
                echo json_encode(['destinatarios'=>$mail['destinatarios'],'asunto'=>$mail['asunto'],
                    'contenido'=>strip_tags($mail['html'])],JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
                continue;
            }
            $status = (new GraphMailService())->send($mail['destinatarios'],$mail['asunto'],$mail['html']);
            echo "$tipo $event: aceptado por Graph, HTTP $status; destino arivera@texpro.cl\n";
        } catch (Throwable $e) {
            $failures++;
            // Los errores Graph solo contienen HTTP o diagnóstico de conexión; nunca cuerpos/tokens.
            echo "$tipo $event: NO aceptado. " . $e->getMessage() . "\n";
        }
    }
} finally { if ($pdo->inTransaction()) $pdo->rollBack(); }
echo "No se verifica entrega física a bandeja. Datos de prueba revertidos.\n";
exit($failures ? 1 : 0);
