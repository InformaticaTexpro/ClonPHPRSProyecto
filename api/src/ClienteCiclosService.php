<?php
declare(strict_types=1);
require_once __DIR__.'/ClienteActividadSoftlandService.php';
require_once __DIR__.'/GraphMailService.php';

final class ClienteCiclosService
{
    public const BLOQUEADOS=['RESERVADO_BORRADOR','EN_TRAMITE','EN_GESTION','EXTENDIDO','CONVERTIDO'];
    public const MENSAJE_BLOQUEADO='El cliente ya existe como Prospecto o Cliente. Valide la información con el área de Créditos.';
    private ClienteActividadSoftlandService $actividad;
    public function __construct(private Database $db,?ClienteActividadSoftlandService $actividad=null,private ?Closure $clock=null)
    {
        $this->actividad=$actividad??new ClienteActividadSoftlandService($db);
    }
    public function ahora(): DateTimeImmutable { return $this->clock?($this->clock)():new DateTimeImmutable('now',new DateTimeZone('America/Santiago')); }
    private function fecha(): string { return $this->ahora()->format('Y-m-d H:i:s'); }
    private function rows(string $sql,array $params=[]): array { $s=$this->db->mysql()->prepare($sql);$s->execute($params);return $s->fetchAll(PDO::FETCH_ASSOC); }
    private function exec(string $sql,array $params=[]): int { $s=$this->db->mysql()->prepare($sql);$s->execute($params);return $s->rowCount(); }
    private function lock(): string { return $this->db->mysql()->getAttribute(PDO::ATTR_DRIVER_NAME)==='mysql'?' FOR UPDATE':''; }
    public function transaccion(callable $operation): array
    {
        $p=$this->db->mysql();if($p->inTransaction())return $operation();
        for($attempt=0;$attempt<3;$attempt++){$p->beginTransaction();
        try{$r=$operation();$p->commit();return $r;}catch(Throwable $e){if($p->inTransaction())$p->rollBack();
            if($e instanceof PDOException && (string)$e->getCode()==='40001' && $attempt<2){usleep(20000*($attempt+1));continue;}
            if($e instanceof PDOException && (string)$e->getCode()==='40001')throw new RuntimeException('Reserva concurrente del RUT. Vuelva a validar e intente nuevamente.',409);
            if($e instanceof PDOException && (str_contains($e->getMessage(),'uq_cliente_ciclo_rut')||str_contains($e->getMessage(),'cliente_ciclo_comercial.rut_bloqueado')))throw new RuntimeException(self::MENSAJE_BLOQUEADO,409);
            throw $e;}
        }
    }
    public function evento(array $c,string $action,?string $before,array $user=[],string $comment='',array $data=[]): void
    {
        $this->exec('INSERT INTO cliente_ciclo_historial(ciclo_id,accion,estado_anterior,estado_nuevo,usuario_id,usuario_nombre,comentario,datos_evento,creado_en) VALUES(?,?,?,?,?,?,?,?,?)',
            [$c['id'],$action,$before,$c['estado'],$user['sub']??$user['id']??null,$user['nombre']??'Proceso C&P',$comment,json_encode($data,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),$this->fecha()]);
    }
    public function plazos(int $userId): array
    {
        $user=$this->rows('SELECT area,nombre,email FROM usuario WHERE id=? AND is_active=1',[$userId])[0]??null;
        if(!$user)throw new RuntimeException('Vendedor activo no encontrado.',422);
        // Misma fuente autoritativa usuario.area usada por Analytics/cartera. No usar productos.
        $area=strtoupper(trim((string)$user['area']));$area=trim((string)preg_replace('/[^A-Z0-9_]/','',preg_replace('/\s+/','_',$area)),'_');
        if($area==='TRATAMIENTO_AGUA')return $user+['tipo_area'=>'TRAT_AGUA','dias_plazo_inicial'=>120,'dias_extension'=>60];
        if(in_array($area,['PRODUCTOS_QUIMICOS','VENTAS','QUIMICOS'],true))return $user+['tipo_area'=>'QUIMICOS','dias_plazo_inicial'=>60,'dias_extension'=>30];
        throw new RuntimeException('El área comercial del vendedor no está configurada en usuario.area.',422);
    }
    private function cambio(array $c,array $data,string $action,array $user=[],string $comment='',array $event=[]): array
    {
        $before=$c['estado'];$data['actualizado_en']=$this->fecha();
        $this->exec('UPDATE cliente_ciclo_comercial SET '.implode(',',array_map(static fn($k)=>$k.'=?',array_keys($data))).' WHERE id=?',[...array_values($data),$c['id']]);
        $c=array_replace($c,$data);$this->evento($c,$action,$before,$user,$comment,$data+$event);return $c;
    }
    public function expirar(?string $rut=null): array
    {
        return $this->transaccion(function()use($rut){
            $p=[$this->fecha()];$where="estado='RESERVADO_BORRADOR' AND reserva_hasta<=?";
            if($rut!==null){$where.=' AND rut_normalizado=?';$p[]=$rut;}
            $expired=$this->rows('SELECT * FROM cliente_ciclo_comercial WHERE '.$where.$this->lock(),$p);
            foreach($expired as $c)$this->liberarInterno($c,'BORRADOR_VENCIDO','Reserva inicial de 7 días vencida.');
            return ['vencidos'=>count($expired)];
        });
    }
    private function activo(string $rut): ?array { return $this->rows('SELECT * FROM cliente_ciclo_comercial WHERE rut_bloqueado=?'.$this->lock(),[$rut])[0]??null; }
    public function validar(string $rut,int $userId): array
    {
        $this->expirar($rut);
        $c=$this->activo($rut);
        if($c){$own=(int)$c['usuario_vendedor_id']===$userId;
            return ['ok'=>true,'bloqueado'=>true,'propio'=>$own,'mensaje'=>$own?'Ya posee una solicitud/ciclo vigente.':self::MENSAJE_BLOQUEADO,
                'ciclo_id'=>$own?(int)$c['id']:null,'solicitud'=>$own?$this->solicitudPropia($c,$userId):null];}
        // Conserva protección de registros anteriores aún no regularizados, sin inventar propietario.
        $legacy=$this->rows("SELECT id,usuario_vendedor_id FROM cliente_solicitud WHERE ciclo_comercial_id IS NULL AND rut_normalizado=? AND estado<>'ANULADA' AND NOT(estado='RECHAZADA' AND rechazo_definitivo=1) ORDER BY id",[$rut]);
        if($legacy){$own=count(array_filter($legacy,static fn($r)=>(int)$r['usuario_vendedor_id']!==$userId))===0;
            return ['ok'=>true,'bloqueado'=>true,'propio'=>$own,'mensaje'=>$own?'Ya posee una solicitud vigente; su ciclo requiere regularización por Créditos.':self::MENSAJE_BLOQUEADO,'solicitud'=>$own?['id'=>$legacy[0]['id']]:null,'ciclo_id'=>null];}
        $previous=$this->rows('SELECT id FROM cliente_ciclo_comercial WHERE rut_normalizado=? ORDER BY id DESC LIMIT 1',[$rut]);
        return ['ok'=>true,'bloqueado'=>false,'propio'=>false,'mensaje'=>$previous?'Este cliente tuvo una gestión comercial anterior y actualmente se encuentra disponible.':'RUT disponible.'];
    }
    private function solicitudPropia(array $c,int $userId): ?array
    {
        return $this->rows('SELECT id,correlativo,estado,tipo FROM cliente_solicitud WHERE ciclo_comercial_id=? AND usuario_vendedor_id=? ORDER BY id DESC LIMIT 1',[$c['id'],$userId])[0]??null;
    }
    /** Ejecutada dentro de la transacción de guardado de la solicitud. */
    public function reservar(array $data,array $user,?array $old,?array $origin,bool $send): ?int
    {
        $rut=$data['rut_normalizado'];if($rut==='')return null;
        $uid=(int)($user['sub']??$user['id']);
        if($origin&&empty($origin['ciclo_comercial_id']))throw new RuntimeException('El Prospecto histórico requiere regularización de ciclo por Créditos antes de crear su Ficha.',409);
        $linked=$old['ciclo_comercial_id']??$origin['ciclo_comercial_id']??null;
        if($linked){
            $c=$this->rows('SELECT * FROM cliente_ciclo_comercial WHERE id=?'.$this->lock(),[$linked])[0]??null;
            if(!$c||(int)$c['usuario_vendedor_id']!==$uid||$c['rut_normalizado']!==$rut||!in_array($c['estado'],self::BLOQUEADOS,true))throw new RuntimeException('El ciclo ya no permite editar esta solicitud o cambiar su RUT.',409);
            if($send&&$c['estado']==='RESERVADO_BORRADOR')$this->cambio($c,['estado'=>'EN_TRAMITE'],'SOLICITUD_ENVIADA',$user);
            return (int)$linked;
        }
        if($c=$this->activo($rut)){
            if($origin&&(int)$c['usuario_vendedor_id']===$uid&&(int)$origin['ciclo_comercial_id']===(int)$c['id'])return (int)$c['id'];
            throw new RuntimeException((int)$c['usuario_vendedor_id']===$uid?'Ya posee una solicitud/ciclo vigente para este RUT. Abra la solicitud existente.':self::MENSAJE_BLOQUEADO,409);
        }
        $legacy=$this->rows("SELECT id,usuario_vendedor_id FROM cliente_solicitud WHERE ciclo_comercial_id IS NULL AND rut_normalizado=? AND estado<>'ANULADA' AND NOT(estado='RECHAZADA' AND rechazo_definitivo=1) AND id<>?",[$rut,$old['id']??0]);
        foreach($legacy as $r)if(!$origin||(int)$r['usuario_vendedor_id']!==$uid)throw new RuntimeException(self::MENSAJE_BLOQUEADO,409);
        $previous=$this->rows('SELECT * FROM cliente_ciclo_comercial WHERE rut_normalizado=? ORDER BY id DESC LIMIT 1',[$rut])[0]??null;
        $rules=$this->plazos($uid);
        $created=$old['creado_en']??$this->fecha();
        $aux=$previous['codigo_auxiliar_softland']??null;
        $values=[$previous['id']??null,$origin['id']??null,$data['rut_original'],$rut,$aux,$uid,$rules['nombre'],$rules['email'],$data['codigo_vendedor'],$rules['tipo_area'],$rules['dias_plazo_inicial'],$rules['dias_extension'],$send?'EN_TRAMITE':'RESERVADO_BORRADOR',(new DateTimeImmutable($created))->modify('+7 days')->format('Y-m-d H:i:s'),$created,$this->fecha()];
        $this->exec('INSERT INTO cliente_ciclo_comercial(ciclo_anterior_id,solicitud_origen_id,rut_original,rut_normalizado,codigo_auxiliar_softland,usuario_vendedor_id,vendedor_nombre,vendedor_email,codigo_vendedor_origen,tipo_area,dias_plazo_inicial,dias_extension,estado,reserva_hasta,creado_en,actualizado_en) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',$values);
        $id=(int)$this->db->mysql()->lastInsertId();$this->evento($this->rows('SELECT * FROM cliente_ciclo_comercial WHERE id=?',[$id])[0],'CICLO_RESERVADO',null,$user);
        return $id;
    }
    public function vincular(int $cycle,int $request): void { $this->exec('UPDATE cliente_ciclo_comercial SET solicitud_origen_id=COALESCE(solicitud_origen_id,?) WHERE id=?',[$request,$cycle]); }
    /** Solo trámite rechazado: trazabilidad de la decisión en cliente_solicitud_historial. */
    public function liberarTramiteRechazado(int $id): void
    {
        $c=$this->rows('SELECT * FROM cliente_ciclo_comercial WHERE id=?'.$this->lock(),[$id])[0]??null;
        if(!$c||!in_array($c['estado'],['RESERVADO_BORRADOR','EN_TRAMITE'],true))return;
        if($this->rows("SELECT id FROM cliente_solicitud WHERE ciclo_comercial_id=? AND (estado IN ('BORRADOR','PENDIENTE','EN_REVISION','OBSERVADA') OR (estado='RECHAZADA' AND rechazo_definitivo=0)) LIMIT 1",[$id]))return;
        $this->exec("UPDATE cliente_ciclo_comercial SET estado='LIBERADO',liberado_en=?,liberado_motivo='RECHAZO_DEFINITIVO',actualizado_en=? WHERE id=?",[$this->fecha(),$this->fecha(),$id]);
    }
    public function iniciar(array $row,array $user): void
    {
        if(empty($row['ciclo_comercial_id']))return; // Registros históricos no se atribuyen automáticamente.
        $c=$this->rows('SELECT * FROM cliente_ciclo_comercial WHERE id=?'.$this->lock(),[$row['ciclo_comercial_id']])[0];
        if(!in_array($c['estado'],self::BLOQUEADOS,true))throw new RuntimeException('El ciclo comercial fue liberado o reasignado.',409);
        if(!empty($c['codigo_auxiliar_softland'])&&$c['codigo_auxiliar_softland']!==$row['codigo_auxiliar_softland'])throw new RuntimeException('Debe reutilizar el CodAux ya conocido del ciclo.',422);
        if($c['inicio_gestion'])return; // Ficha derivada no reinicia el plazo del Prospecto.
        $start=substr($row['completado_en'],0,10);
        $this->cambio($c,['estado'=>'EN_GESTION','codigo_auxiliar_softland'=>$row['codigo_auxiliar_softland'],'inicio_gestion'=>$start,'vence_inicial'=>(new DateTimeImmutable($start))->modify('+'.$c['dias_plazo_inicial'].' days')->format('Y-m-d')],'GESTION_INICIADA',$user);
    }
    private function liberarInterno(array $c,string $reason,string $comment,array $user=[]): array
    {
        $c=$this->cambio($c,['estado'=>'LIBERADO','liberado_en'=>$this->fecha(),'liberado_motivo'=>$reason,'liberado_comentario'=>$comment],$reason,$user,$comment);
        $this->anularSolicitudes($c,$reason,$comment,$user);
        return $c;
    }
    private function anularSolicitudes(array $c,string $reason,string $comment,array $user): void
    {
        // Mantener índices históricos de solicitud sin bloquear el reingreso de un ciclo liberado.
        foreach($this->rows("SELECT * FROM cliente_solicitud WHERE ciclo_comercial_id=? AND estado IN ('BORRADOR','PENDIENTE','EN_REVISION','OBSERVADA')",[$c['id']]) as $s){
            $this->exec("UPDATE cliente_solicitud SET estado='ANULADA',actualizado_en=? WHERE id=?",[$this->fecha(),$s['id']]);
            $this->exec("INSERT INTO cliente_solicitud_historial(solicitud_id,accion,estado_anterior,estado_nuevo,usuario_id,usuario_nombre,comentario,datos_evento) VALUES(?,?,?,'ANULADA',?,?,?,?)",[$s['id'],$reason,$s['estado'],$user['sub']??$user['id']??0,$user['nombre']??'Proceso C&P',$comment,json_encode(['ciclo_comercial_id'=>$c['id']])]);
        }
    }
    private function autorizado(array $user,bool $global): int
    {
        $uid=(int)($user['sub']??$user['id']??0);if(!$uid)throw new RuntimeException('Sesión requerida.',401);
        $code=$global?'cobranza_clientes_prospectos':'ventas_clientes_prospectos';
        foreach($user['menus']??[] as $m)if(($m['codigo']??'')===$code&&(!isset($m['activo'])||$m['activo']))return $uid;
        throw new RuntimeException('No tiene permiso para esta operación.',403);
    }
    public function obtener(int $id,array $user,bool $global=false,bool $lock=false): array
    {
        $uid=$this->autorizado($user,$global);$params=[$id];$where='id=?';
        if(!$global){$where.=' AND usuario_vendedor_id=?';$params[]=$uid;}
        $c=$this->rows('SELECT * FROM cliente_ciclo_comercial WHERE '.$where.($lock?$this->lock():''),$params)[0]??null;
        if(!$c)throw new RuntimeException('Ciclo no encontrado.',404);return $c;
    }
    public function publico(array $c,bool $global=false): array
    {
        $end=$c['extension_usada']?$c['vence_extension']:$c['vence_inicial'];
        $days=$end?(int)$this->ahora()->setTime(0,0)->diff(new DateTimeImmutable($end,$this->ahora()->getTimezone()))->format('%r%a'):null;
        $c['dias_restantes']=$days;
        $c['fecha_vencimiento_aplicable']=$end;
        $c['esta_en_extension']=$c['estado']==='EXTENDIDO';
        $c['vigencia_nivel']=$days===null?'neutral':($days<=3?'danger':($days<=10?'warning':'ok'));
        $c['puede_intentar_extension']=$c['estado']==='EN_GESTION'&&!$c['extension_usada']&&!$c['facturas_count']&&$days!==null&&$days>=0&&$days<=10;
        $c['extension_acreditada']=(int)$c['cotizaciones_count']+(int)$c['notas_venta_count']>0;
        if(!$global)foreach(['cotizaciones_otros_count','notas_venta_otros_count','facturas_otros_count','liberado_comentario'] as $key)unset($c[$key]);
        return $c;
    }
    public function resumen(array $user,bool $global=false): array
    {
        $uid=$this->autorizado($user,$global);
        $rows=$this->rows('SELECT * FROM cliente_ciclo_comercial'.($global?'':' WHERE usuario_vendedor_id=?'),$global?[]:[$uid]);
        $counts=['EN_GESTION'=>0,'POR_VENCER'=>0,'EXTENDIDO'=>0,'CONVERTIDO'=>0];
        foreach($rows as $c){$c=$this->publico($c,$global);if(isset($counts[$c['estado']]))$counts[$c['estado']]++;
            if(in_array($c['estado'],['EN_GESTION','EXTENDIDO'],true)&&$c['dias_restantes']>=0&&$c['dias_restantes']<=10)$counts['POR_VENCER']++;}
        return ['ok'=>true,'resumen'=>$counts];
    }
    public function extender(int $id,array $user): array
    {
        $c=$this->obtener($id,$user);
        if(!$this->publico($c)['puede_intentar_extension'])throw new RuntimeException('La extensión única solo está disponible durante los últimos 10 días del plazo inicial.',409);
        if(!(int)$c['cotizaciones_count']&&!(int)$c['notas_venta_count']){
            $data=$this->actividad->cabeceras([$c]); // Una validación puntual (cabeceras), nunca detalles.
            $this->sincronizar([$c],$data,false,false);
        }
        return $this->transaccion(function()use($id,$user){
            $c=$this->obtener($id,$user,false,true);
            if(!$this->publico($c)['puede_intentar_extension']||(!(int)$c['cotizaciones_count']&&!(int)$c['notas_venta_count']))throw new RuntimeException('Debe existir una Cotización o Nota de Venta propia válida para extender.',409);
            $end=(new DateTimeImmutable($c['vence_inicial']))->modify('+'.$c['dias_extension'].' days')->format('Y-m-d');
            return ['ok'=>true,'ciclo'=>$this->publico($this->cambio($c,['estado'=>'EXTENDIDO','extension_usada'=>1,'extension_activada_en'=>$this->fecha(),'vence_extension'=>$end],'EXTENSION_ACTIVADA',$user))];
        });
    }
    public function liberar(int $id,array $user,string $comment): array
    {
        if(trim($comment)===''||mb_strlen($comment)>4000)throw new RuntimeException('Debe indicar un motivo/comentario de hasta 4000 caracteres.',422);
        return $this->transaccion(function()use($id,$user,$comment){$c=$this->obtener($id,$user,true,true);
            if(!in_array($c['estado'],['EN_GESTION','EXTENDIDO'],true))throw new RuntimeException('Solo se liberan administrativamente ciclos comerciales activos.',409);
            return ['ok'=>true,'ciclo'=>$this->publico($this->liberarInterno($c,'LIBERACION_MANUAL',$comment,$user),true)];});
    }
    public function reasignar(int $id,array $user,int $destination,string $comment): array
    {
        if(trim($comment)===''||mb_strlen($comment)>4000)throw new RuntimeException('Indique motivo de reasignación (máximo 4000 caracteres).',422);
        return $this->transaccion(function()use($id,$user,$destination,$comment){
            $c=$this->obtener($id,$user,true,true);
            if(!in_array($c['estado'],['EN_GESTION','EXTENDIDO'],true)||$destination===(int)$c['usuario_vendedor_id'])throw new RuntimeException('Solo se reasignan ciclos en gestión a otro vendedor.',409);
            $rules=$this->plazos($destination);$codes=$this->actividad->codigos($destination);if(!$codes)throw new RuntimeException('El destino no tiene códigos vendedor asociados.',422);
            $this->cambio($c,['estado'=>'REASIGNADO'],'REASIGNADO',$user,$comment,['destino'=>$destination]);
            $this->anularSolicitudes($c,'SOLICITUD_REASIGNADA',$comment,$user);
            $date=$this->ahora()->format('Y-m-d');
            $this->exec("INSERT INTO cliente_ciclo_comercial(ciclo_anterior_id,rut_original,rut_normalizado,codigo_auxiliar_softland,usuario_vendedor_id,vendedor_nombre,vendedor_email,codigo_vendedor_origen,tipo_area,dias_plazo_inicial,dias_extension,estado,inicio_gestion,vence_inicial) VALUES(?,?,?,?,?,?,?,?,?,?,?,'EN_GESTION',?,?)",[$id,$c['rut_original'],$c['rut_normalizado'],$c['codigo_auxiliar_softland'],$destination,$rules['nombre'],$rules['email'],$codes[0],$rules['tipo_area'],$rules['dias_plazo_inicial'],$rules['dias_extension'],$date,$this->ahora()->modify('+'.$rules['dias_plazo_inicial'].' days')->format('Y-m-d')]);
            $new=$this->rows('SELECT * FROM cliente_ciclo_comercial WHERE id=?',[(int)$this->db->mysql()->lastInsertId()])[0];
            $this->evento($new,'RECIBIDO_POR_REASIGNACION',null,$user,$comment,['ciclo_anterior_id'=>$id]);
            return ['ok'=>true,'ciclo'=>$this->publico($new,true)];
        });
    }
    /** Aplica un lote ya leído completo; un fallo de lectura nunca llega a liberar. */
    public function sincronizar(array $cycles,array $data,bool $release=true,bool $dry=false): array
    {
        $results=[];
        foreach($cycles as $snapshot){
            $codes=$this->actividad->codigos((int)$snapshot['usuario_vendedor_id']);
            if(!$codes)throw new RuntimeException('Propietario sin códigos vendedor; sincronización abortada.',409);
            $changes=[];$invoice=null;
            foreach(['cotizaciones'=>['cotizaciones_count','cotizaciones_otros_count','ultima_cotizacion_fecha'],'notas-venta'=>['notas_venta_count','notas_venta_otros_count','ultima_nota_venta_fecha'],'facturas'=>['facturas_count','facturas_otros_count','ultima_factura_fecha']] as $type=>[$ownKey,$otherKey,$lastKey]){
                $changes[$ownKey]=0;$changes[$otherKey]=0;$changes[$lastKey]=null;$seen=[];
                foreach($data[$type]??[] as $doc){
                    if(trim((string)$doc['codaux'])!==trim((string)$snapshot['codigo_auxiliar_softland'])||$doc['fecha']<$snapshot['inicio_gestion']||$doc['fecha']>$this->ahora()->format('Y-m-d')||strtoupper(trim((string)$doc['estado']))==='A'||(float)$doc['neto']<=0)continue;
                    $key=$doc['numero'].'|'.$doc['vendedor'];if(isset($seen[$key]))continue;$seen[$key]=true;
                    $own=in_array(trim((string)$doc['vendedor']),$codes,true);$changes[$own?$ownKey:$otherKey]++;
                    if($own){$changes[$lastKey]=max($changes[$lastKey]??'',$doc['fecha']);
                        if($type==='facturas'&&($invoice===null||[$doc['fecha'],(int)$doc['numero']]<[$invoice['fecha'],(int)$invoice['numero']]))$invoice=$doc;}
                }
            }
            $changes['ultima_sincronizacion_softland']=$this->fecha();
            $info=['id'=>$snapshot['id'],'cache'=>$changes,'convertir'=>$invoice!==null];
            if($dry){$results[]=$info+['sincronizado'=>true,'convertido'=>$invoice!==null,'liberado'=>$invoice===null&&$release&&($snapshot['extension_usada']?$snapshot['vence_extension']:$snapshot['vence_inicial'])<$this->ahora()->format('Y-m-d')];continue;}
            $applied=$this->transaccion(function()use($snapshot,$changes,$invoice,$release){
                $c=$this->rows('SELECT * FROM cliente_ciclo_comercial WHERE id=?'.$this->lock(),[$snapshot['id']])[0]??null;
                if(!$c||!in_array($c['estado'],['EN_GESTION','EXTENDIDO'],true)||$c['usuario_vendedor_id']!=$snapshot['usuario_vendedor_id']||$c['inicio_gestion']!==$snapshot['inicio_gestion']||$c['codigo_auxiliar_softland']!==$snapshot['codigo_auxiliar_softland'])return [];
                $c=$this->cambio($c,$changes,'ACTIVIDAD_SINCRONIZADA');
                $released=false;
                if($invoice){$this->cambio($c,['estado'=>'CONVERTIDO','factura_conversion_folio'=>(string)$invoice['numero'],'factura_conversion_fecha'=>$invoice['fecha'],'factura_conversion_cod_vendedor'=>$invoice['vendedor'],'conversion_detectada_en'=>$this->fecha()],'CONVERTIDO_POR_FACTURA');}
                elseif($release&&($c['extension_usada']?$c['vence_extension']:$c['vence_inicial'])<$this->ahora()->format('Y-m-d')){$this->liberarInterno($c,$c['extension_usada']?'PLAZO_EXTENSION_VENCIDO':'PLAZO_INICIAL_VENCIDO','Plazo comercial vencido sin Factura propia válida.');$released=true;}
                return ['sincronizado'=>true,'convertido'=>$invoice!==null,'liberado'=>$released];
            });
            $results[]=$info+$applied;
        }
        return $results;
    }
    public function procesar(bool $dry=false,bool $noMail=true,int $limit=1000): array
    {
        $result=['borradores'=>0,'revisados'=>0,'ciclos'=>0,'lotes'=>0,'sincronizados'=>0,'convertidos'=>0,'liberados'=>0,'alertas'=>['creadas'=>0,'enviadas'=>0,'errores'=>0],'errores'=>[],'dry_run'=>$dry];
        if(!$dry)$result['borradores']=$this->expirar()['vencidos'];
        else $result['borradores']=(int)$this->rows("SELECT COUNT(*) AS total FROM cliente_ciclo_comercial WHERE estado='RESERVADO_BORRADOR' AND reserva_hasta<=?",[$this->fecha()])[0]['total'];
        $cycles=$this->rows("SELECT * FROM cliente_ciclo_comercial WHERE estado IN ('EN_GESTION','EXTENDIDO') ORDER BY COALESCE(ultima_sincronizacion_softland,creado_en),id LIMIT ".max(1,min($limit,10000)));
        $result['revisados']=count($cycles);
        foreach(array_chunk($cycles,100) as $batch){
            try{$data=$this->actividad->cabeceras($batch);$outcomes=$this->sincronizar($batch,$data,true,$dry);$result['ciclos']+=count($batch);$result['lotes']++;
                foreach(['sincronizados'=>'sincronizado','convertidos'=>'convertido','liberados'=>'liberado'] as $metric=>$key)$result[$metric]+=count(array_filter($outcomes,static fn($row)=>!empty($row[$key])));}
            catch(Throwable){$result['errores'][]='No se completó la sincronización de un lote. Estados no liberados por datos ausentes; reintentar.';}
        }
        if(!$dry&&empty($result['errores'])){$result['alertas']=$this->alertas($noMail);if($result['alertas']['errores'])$result['errores'][]='Falló el envío de una o más alertas; resultado registrado para revisión.';}
        return $result;
    }
    private function alertas(bool $noMail): array
    {
        $created=$sent=$errors=0;
        foreach($this->rows("SELECT * FROM cliente_ciclo_comercial WHERE estado IN ('EN_GESTION','EXTENDIDO')") as $c){
            $public=$this->publico($c);$days=$public['dias_restantes'];$extended=(bool)$c['extension_usada'];
            foreach($extended?[7,2,0]:[10,3,0] as $threshold){
                if($days!==$threshold)continue;
                $type=($extended?'EXTENSION_':'INICIAL_').$threshold;
                try{$this->exec('INSERT INTO cliente_ciclo_alerta(ciclo_id,tipo,fecha_alerta,destinatario) VALUES(?,?,?,?)',[$c['id'],$type,$this->ahora()->format('Y-m-d'),$c['vendedor_email']]);$created++;}
                catch(PDOException $e){if(!in_array((string)$e->getCode(),['23000','23505'],true))throw $e;}
            }
        }
        if($noMail||strtolower((string)env('CLIENT_SOLICITUD_MAIL_ENABLED','false'))!=='true')return ['creadas'=>$created,'enviadas'=>0,'errores'=>0];
        foreach($this->rows("SELECT a.id AS alerta_id,a.tipo,c.* FROM cliente_ciclo_alerta a JOIN cliente_ciclo_comercial c ON c.id=a.ciclo_id WHERE a.estado='PENDIENTE' AND a.intentos=0 AND c.estado IN ('EN_GESTION','EXTENDIDO')") as $c){
            // Reclamo único. Un intento incierto nunca se reenvía automáticamente.
            if(!$this->exec("UPDATE cliente_ciclo_alerta SET intentos=intentos+1 WHERE id=? AND estado='PENDIENTE' AND intentos=0",[$c['alerta_id']]))continue;
            try{
                $recipients=[$c['vendedor_email']];
                if(strtolower((string)env('CLIENT_SOLICITUD_MAIL_TEST_MODE','false'))==='true'){
                    $target=strtolower(trim((string)env('CLIENT_SOLICITUD_MAIL_TEST_RECIPIENT')));
                    if($target==='')throw new RuntimeException('CLIENT_SOLICITUD_MAIL_TEST_RECIPIENT no configurado.');
                    if($target!=='arivera@texpro.cl')throw new RuntimeException('Modo TEST permitido únicamente para arivera@texpro.cl.');$recipients=[$target];
                }
                $name=$this->rows('SELECT razon_social FROM cliente_solicitud WHERE id=?',[$c['solicitud_origen_id']])[0]['razon_social']??$c['rut_original'];
                $text=$name.' · CodAux '.$c['codigo_auxiliar_softland'].' · '.$this->publico($c)['dias_restantes'].' días restantes. Cotizaciones: '.$c['cotizaciones_count'].'; NV: '.$c['notas_venta_count'].'; Facturas: '.$c['facturas_count'];
                $url=rtrim((string)env('FRONTEND_URL','http://localhost:8000'),'/').'/src/modulo/ventas/clientes-prospectos/index.html?ciclo='.$c['id'];
                (new GraphMailService())->send($recipients,'Vigencia comercial · '.$c['tipo'],'<p>'.htmlspecialchars($text,ENT_QUOTES,'UTF-8').'</p><a href="'.htmlspecialchars($url,ENT_QUOTES,'UTF-8').'">Abrir GICOTEX</a>');
                $this->exec("UPDATE cliente_ciclo_alerta SET estado='ENVIADO',destinatario=?,enviado_en=? WHERE id=?",[implode(',',$recipients),$this->fecha(),$c['alerta_id']]);$sent++;
            }catch(Throwable){$errors++;$this->exec("UPDATE cliente_ciclo_alerta SET estado='ERROR',ultimo_error='Envío no confirmado; revisar antes de reintentar' WHERE id=?",[$c['alerta_id']]);}
        }
        return ['creadas'=>$created,'enviadas'=>$sent,'errores'=>$errors];
    }
    public function route(array $user,string $method,string $path,array $query,array $body): array
    {
        $global=($query['ambito']??'')==='gestion';
        if(preg_match('#^/ciclos/(\d+)/historia-prodin(?:/(resumen|documentos|cotizaciones|notas-venta|facturas)(?:/(\d+))?)?$#',$path,$m)&&$method==='GET'){
            $this->autorizado($user,true);$c=$this->obtener((int)$m[1],$user,true);
            if(!$c['codigo_auxiliar_softland']||!$c['inicio_gestion'])throw new RuntimeException('Se requiere CodAux e inicio de gestión para consultar antecedentes.',409);
            $action=$m[2]??'resumen';
            if($action==='resumen')return $this->actividad->resumenHistorico($c);
            if($action==='documentos')return $this->actividad->historicos($c,(int)($query['pagina']??1),isset($query['tipo'])?(string)$query['tipo']:null);
            if(empty($m[3]))throw new RuntimeException('Seleccione un documento histórico específico.',422);
            return $this->actividad->documentos($c,$action,true,(int)$m[3],true);
        }
        if($path==='/ciclos/vendedores'&&$method==='GET'){
            $this->autorizado($user,true);
            return ['ok'=>true,'vendedores'=>$this->rows('SELECT DISTINCT u.id,u.nombre,u.area FROM usuario u JOIN usuario_vendedor uv ON uv.usuario_id=u.id WHERE u.is_active=1 ORDER BY u.nombre')];
        }
        if($path==='/ciclos'&&$method==='GET'){
            $uid=$this->autorizado($user,$global);$where=['1=1'];$params=[];
            if(!$global){$where[]='usuario_vendedor_id=?';$params[]=$uid;}
            $state=(string)($query['estado']??'');
            if($state==='POR_VENCER'){
                $where[]="estado IN ('EN_GESTION','EXTENDIDO') AND (CASE WHEN extension_usada=1 THEN vence_extension ELSE vence_inicial END) BETWEEN ? AND ?";
                $params[]=$this->ahora()->format('Y-m-d');$params[]=$this->ahora()->modify('+10 days')->format('Y-m-d');
            }elseif($state!==''){
                if(!in_array($state,[...self::BLOQUEADOS,'LIBERADO','REASIGNADO'],true))throw new RuntimeException('Estado de ciclo inválido.',422);
                $where[]='estado=?';$params[]=$state;
            }
            $condition=implode(' AND ',$where);$page=max(1,(int)($query['pagina']??1));
            $count=(int)$this->rows('SELECT COUNT(*) AS total FROM cliente_ciclo_comercial WHERE '.$condition,$params)[0]['total'];
            $rows=$this->rows('SELECT * FROM cliente_ciclo_comercial WHERE '.$condition.' ORDER BY id DESC LIMIT 50 OFFSET '.(($page-1)*50),$params);
            return ['ok'=>true,'ciclos'=>array_map(fn($c)=>$this->publico($c,$global),$rows),'total'=>$count,'pagina'=>$page];
        }
        if($path==='/ciclos/resumen'&&$method==='GET')return $this->resumen($user,$global);
        if($path==='/validar-rut'&&$method==='GET')return $this->validar(ClienteSolicitudesService::normalizarRut((string)($query['rut']??'')),$this->autorizado($user,false));
        if(preg_match('#^/ciclos/(\d+)(?:/(extender|liberar|reasignar|actividad|historial|cotizaciones|notas-venta|facturas)(?:/(\d+))?)?$#',$path,$m)){
            $id=(int)$m[1];$action=$m[2]??'';
            if($method==='POST'&&$action==='extender')return $this->extender($id,$user);
            if($method==='POST'&&$action==='liberar')return $this->liberar($id,$user,(string)($body['comentario']??''));
            if($method==='POST'&&$action==='reasignar')return $this->reasignar($id,$user,(int)($body['usuario_vendedor_id']??0),(string)($body['comentario']??''));
            $c=$this->obtener($id,$user,$global);
            if($method==='GET'&&in_array($action,['','actividad'],true))return ['ok'=>true,'ciclo'=>$this->publico($c,$global)];
            if($method==='GET'&&$action==='historial'){
                // Historia de otros propietarios solo para gestión; el ciclo propio no contiene documentos ajenos.
                $history=$this->rows('SELECT accion,estado_anterior,estado_nuevo,usuario_nombre,comentario,datos_evento,creado_en FROM cliente_ciclo_historial WHERE ciclo_id=? ORDER BY id',[$id]);
                $names=['CICLO_RESERVADO'=>'Reserva de borrador creada','SOLICITUD_ENVIADA'=>'Solicitud enviada a Cobranzas','GESTION_INICIADA'=>'Gestión comercial iniciada','CICLO_REGULARIZADO_HISTORICO'=>'Ciclo creado por regularización histórica','ACTIVIDAD_SINCRONIZADA'=>'Actividad comercial actualizada','CONVERTIDO_POR_FACTURA'=>'Cliente convertido por venta','EXTENSION_ACTIVADA'=>'Extensión comercial activada','LIBERACION_MANUAL'=>'Cliente liberado','BORRADOR_VENCIDO'=>'Reserva de borrador vencida','PLAZO_INICIAL_VENCIDO'=>'Cliente liberado por vencimiento inicial','PLAZO_EXTENSION_VENCIDO'=>'Cliente liberado por vencimiento de extensión','REASIGNADO'=>'Cliente reasignado','RECIBIDO_POR_REASIGNACION'=>'Cliente recibido por reasignación'];
                foreach($history as &$event){
                    $event['etiqueta']=$names[$event['accion']]??'Seguimiento comercial actualizado';
                    $data=json_decode($event['datos_evento']??'',true)?:[];
                    $event['resumen']=match($event['accion']){
                        'GESTION_INICIADA','CICLO_REGULARIZADO_HISTORICO'=>'Vigencia inicial: '.(int)$c['dias_plazo_inicial'].' días',
                        'ACTIVIDAD_SINCRONIZADA'=>(int)($data['cotizaciones_count']??0).' cotizaciones · '.(int)($data['notas_venta_count']??0).' NV · '.(int)($data['facturas_count']??0).' facturas',
                        'EXTENSION_ACTIVADA'=>'Nueva vigencia hasta '.($data['vence_extension']??'—'),
                        'CONVERTIDO_POR_FACTURA'=>'Factura N° '.($data['factura_conversion_folio']??'—'),
                        default=>'',
                    };
                    unset($event['datos_evento']);
                    if(!$global)unset($event['comentario'],$event['usuario_nombre'],$event['accion']);
                }unset($event);
                return ['ok'=>true,'historial'=>$history];
            }
            if($method==='GET'&&in_array($action,['cotizaciones','notas-venta','facturas'],true)){
                if(!$c['inicio_gestion']||!$c['codigo_auxiliar_softland'])return ['ok'=>true,'documentos'=>[],'total'=>0];
                return $this->actividad->documentos($c,$action,$global,isset($m[3])?(int)$m[3]:null);
            }
        }
        throw new RuntimeException('Ruta de ciclo comercial no encontrada.',404);
    }
}
