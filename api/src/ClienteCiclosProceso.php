<?php
declare(strict_types=1);
require_once __DIR__.'/ClienteSolicitudesService.php';

/** Orquestación CLI; las decisiones comerciales permanecen en los servicios. */
final class ClienteCiclosProceso
{
    public function __construct(private Database $db,private ?ClienteCiclosService $ciclos=null,private ?ClienteSolicitudesService $solicitudes=null) {}

    public static function validarEntorno(bool $dry): void
    {
        $environment=strtolower(trim((string)env('APP_ENV','')));
        if($environment!=='production'&&!($dry&&in_array($environment,['local','test','testing'],true)))throw new RuntimeException('APP_ENV debe ser production; local/test sólo admite --dry-run.');
        foreach(['DB_HOST','DB_NAME','DB_USER'] as $key)if(trim((string)env($key,''))==='')throw new RuntimeException('Configuración MySQL incompleta.');
    }

    public function ejecutar(bool $dry=false,bool $noMail=false,int $limit=1000): array
    {
        if($limit<1||$limit>10000)throw new RuntimeException('Límite permitido: 1 a 10000.');
        $pdo=$this->db->mysql();
        if(!(int)$pdo->query("SELECT GET_LOCK('cliente_ciclos_proceso',0)")->fetchColumn())return ['codigo_salida'=>75,'errores'=>['Existe otra ejecución del proceso de ciclos.'],'dry_run'=>$dry];
        try{
            $ciclos=$this->ciclos??new ClienteCiclosService($this->db);
            $solicitudes=$this->solicitudes??new ClienteSolicitudesService($this->db,$ciclos);
            $rechazos=$solicitudes->procesarRechazos($dry);
            $result=$ciclos->procesar($dry,$noMail,$limit);
            return ['codigo_salida'=>empty($result['errores'])?0:2,'rechazos'=>$rechazos,'ciclos'=>$result,'dry_run'=>$dry];
        }catch(Throwable){
            return ['codigo_salida'=>2,'errores'=>['Proceso incompleto. Revisar conexión, esquema y registros operativos; no reintentar correos de resultado incierto automáticamente.'],'dry_run'=>$dry];
        }finally{$pdo->query("SELECT RELEASE_LOCK('cliente_ciclos_proceso')");}
    }
}
