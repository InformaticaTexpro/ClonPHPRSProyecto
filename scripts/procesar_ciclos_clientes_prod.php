<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(403);exit;}
require_once dirname(__DIR__).'/api/src/Env.php';
require_once dirname(__DIR__).'/api/src/Database.php';
require_once dirname(__DIR__).'/api/src/ClienteCiclosProceso.php';
$options=getopt('',['dry-run','no-mail','limit:','help']);
if(isset($options['help'])){echo "Uso: php scripts/procesar_ciclos_clientes_prod.php [--dry-run] [--no-mail] [--limit=1000]\nAPP_ENV=production para operar. LOCAL/test sólo --dry-run. Configuración desde .env de la app.\n";exit(0);}
load_env_file(dirname(__DIR__).'/.env');
date_default_timezone_set('America/Santiago');
$started=date(DATE_ATOM);$dry=isset($options['dry-run']);$noMail=isset($options['no-mail']);
try{
    ClienteCiclosProceso::validarEntorno($dry);
    $limit=filter_var($options['limit']??1000,FILTER_VALIDATE_INT);
    if($limit===false||$limit<1||$limit>10000)throw new RuntimeException('Límite inválido.');
    $result=(new ClienteCiclosProceso(new Database()))->ejecutar($dry,$noMail,$limit);
}catch(Throwable){$result=['codigo_salida'=>2,'errores'=>['No se pudo iniciar: verifique APP_ENV, opciones, configuración y conectividad.'],'dry_run'=>$dry];}
echo json_encode(['inicio'=>$started,'fin'=>date(DATE_ATOM)]+$result,JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)."\n";
exit($result['codigo_salida']);
