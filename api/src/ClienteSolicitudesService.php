<?php
declare(strict_types=1);
require_once __DIR__ . '/GraphMailService.php';
require_once __DIR__ . '/ClienteCiclosService.php';

final class ClienteSolicitudesService
{
    private const ESTADOS = ['BORRADOR','PENDIENTE','EN_REVISION','OBSERVADA','COMPLETADA','ANULADA','RECHAZADA'];
    private const CAMPOS = ['codigo_vendedor'=>30,'rut_original'=>20,'razon_social'=>120,'contacto_nombre'=>100,
        'contacto_email'=>150,'telefono'=>30,'productos_interes'=>800,'observacion_vendedor'=>1000];
    public const FICHA = [
        'trabaja_con'=>['Trabaja con',30,true,['SOLO FACTURA','O/C FACTURA','OC Y GUIA','O/C GUIA Y HES']],
        'tipo_empresa'=>['Tipo empresa',20,true,['EMPRESA','P NATURAL']],
        'forma_pago'=>['Forma de pago',30,true],
        'origen_canal'=>['Origen / canal',120,true],
        'rubro'=>['Rubro',40,true],
        'rubro_otro'=>['Otro rubro',120,false], 'giro'=>['Giro',255,true],
        'nombre_fantasia'=>['Nombre fantasía',120,false], 'direccion_comercial'=>['Dirección comercial',255,true],
        'ciudad'=>['Ciudad',100,true], 'comuna'=>['Comuna',100,true], 'direccion_despacho'=>['Dirección de despacho',255,true],
        'telefono_empresa'=>['Teléfono empresa',30,false], 'linea_productos'=>['Línea de productos',800,true],
        'tipo_precio'=>['Precio',20,true,['Santiago','Provincia']],
        'encargado_compras'=>['Nombre encargado de compras',100,true], 'telefono_compras'=>['Teléfono compras',30,false],
        'email_compras'=>['Correo compras',150,true,'email'], 'contacto_finanzas'=>['Contacto Finanzas / Pagos',100,true],
        'telefono_finanzas'=>['Teléfono finanzas',30,false], 'email_finanzas'=>['Correo finanzas',150,true,'email'],
        'sitio_web'=>['Sitio web',255,false,'url'], 'banco_referencia'=>['Banco referencia',100,false],
        'tipo_cuenta_referencia'=>['Tipo cuenta',60,false], 'numero_cuenta_referencia'=>['Número cuenta',60,false],
        'titular_cuenta_referencia'=>['Titular cuenta',120,false], 'rut_titular_cuenta_referencia'=>['RUT titular',20,false],
        'email_transferencia_referencia'=>['Email transferencia',150,false,'email'],
    ];
    private const CATALOGOS = ['ORIGEN'=>['origen_canal','origen_codigo'], 'RUBRO'=>['rubro','rubro_codigo'], 'FORMA_PAGO'=>['forma_pago','forma_pago_codigo']];
    public const INTERNOS = [
        'cliente_clasificacion_interna'=>['Clasificación',30,false,['Cliente Nuevo','Cliente Recuperado','Sin Clasificar']],
        'ultima_compra'=>['Última compra',10,false,'date'], 'mes_creacion'=>['Mes creación',7,false,'month'],
        'correlativo_interno'=>['Correlativo interno',60,false], 'observacion_cobranza'=>['Observación Cobranza',4000,false],
    ];

    private ClienteCiclosService $ciclos;
    public function __construct(private Database $db,?ClienteCiclosService $ciclos=null) { $this->ciclos=$ciclos??new ClienteCiclosService($db); }

    private function rows(string $sql, array $params = []): array
    {
        $stmt = $this->db->mysql()->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    private function execute(string $sql, array $params = []): void
    {
        $stmt = $this->db->mysql()->prepare($sql);
        $stmt->execute($params);
    }

    public static function normalizarRut(string $value): string
    {
        $value = strtoupper(trim($value));
        if (!preg_match('/^[0-9.]+-?[0-9K]$/D', $value)) {
            throw new RuntimeException('RUT inválido: revise el formato y dígito verificador.', 422);
        }
        $rut = str_replace(['.','-'], '', $value);
        if (!preg_match('/^[1-9][0-9]{0,7}[0-9K]$/D', $rut)) {
            throw new RuntimeException('RUT inválido.', 422);
        }
        $body = substr($rut, 0, -1);
        $sum = 0; $mul = 2;
        for ($i = strlen($body) - 1; $i >= 0; $i--) {
            $sum += (int)$body[$i] * $mul;
            $mul = $mul === 7 ? 2 : $mul + 1;
        }
        $dv = 11 - ($sum % 11);
        $expected = $dv === 11 ? '0' : ($dv === 10 ? 'K' : (string)$dv);
        if (substr($rut, -1) !== $expected) throw new RuntimeException('El dígito verificador del RUT no es válido.', 422);
        return $rut;
    }

    private function access(array $user, string $level): void
    {
        if ((int)($user['sub'] ?? $user['id'] ?? 0) <= 0) throw new RuntimeException('Sesión requerida.', 401);
        $profiles = array_map(static fn($p) => strtolower((string)(is_array($p) ? ($p['codigo'] ?? '') : $p)), $user['perfiles'] ?? []);
        if ($level === 'admin' && (!empty($user['is_admin']) || array_intersect($profiles, ['administracion','admin']))) return;
        // require_current_user() reconstruye menus desde perfil_menu + usuario_menu activos.
        $code = $level === 'gestion' ? 'cobranza_clientes_prospectos' : 'ventas_clientes_prospectos';
        if ($level !== 'admin') foreach ($user['menus'] ?? [] as $menu) {
            if (($menu['codigo'] ?? '') === $code && (!isset($menu['activo']) || $menu['activo'])) return;
        }
        throw new RuntimeException('No tiene permiso para esta operación.', 403);
    }

    private function id(array $user): int { return (int)($user['sub'] ?? $user['id'] ?? 0); }
    private function tipo(mixed $tipo): string
    {
        if (!in_array($tipo,['PROSPECTO','FICHA'],true)) throw new RuntimeException('Tipo inválido.',422);
        return $tipo;
    }

    private function solicitud(int $id, array $user, bool $global = false, bool $lock = false): array
    {
        $this->access($user, $global ? 'gestion' : 'ventas');
        $suffix = $lock && $this->db->mysql()->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? ' FOR UPDATE' : '';
        $params = [$id];
        $sql = 'SELECT * FROM cliente_solicitud WHERE id=?';
        if (!$global) { $sql .= ' AND usuario_vendedor_id=?'; $params[] = $this->id($user); }
        $row = $this->rows($sql . $suffix, $params)[0] ?? null;
        if (!$row) throw new RuntimeException('Solicitud no encontrada.', 404);
        $row['origen_correlativo'] = !empty($row['solicitud_origen_id']) ? ($this->rows('SELECT correlativo FROM cliente_solicitud WHERE id=?',[$row['solicitud_origen_id']])[0]['correlativo'] ?? null) : null;
        $row['ciclo'] = !empty($row['ciclo_comercial_id']) ? $this->ciclos->publico($this->ciclos->obtener((int)$row['ciclo_comercial_id'],$user,$global),$global) : null;
        if($global)$row['prodin_consulta']=$this->consultaProdinGuardada($row);
        if ($row['tipo'] === 'FICHA') {
            $row['ficha'] = $this->rows('SELECT * FROM cliente_solicitud_ficha WHERE solicitud_id=?',[$id])[0] ?? [];
            unset($row['ficha']['solicitud_id'],$row['ficha']['creado_en'],$row['ficha']['actualizado_en']);
            if (!$global) foreach (array_keys(self::INTERNOS) as $key) unset($row['ficha'][$key]);
        }
        return $this->publicarSolicitud($row);
    }

    private function transaction(callable $operation): array
    {
        $pdo = $this->db->mysql();
        if($pdo->inTransaction())return $operation();
        for($attempt=0;$attempt<3;$attempt++) {
        $pdo->beginTransaction();
        try {
            $result = $operation();
            $pdo->commit();
            return $result;
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($e instanceof PDOException && (string)$e->getCode()==='40001' && $attempt<2) { usleep(20000*($attempt+1));continue; }
            if ($e instanceof PDOException && (string)$e->getCode()==='40001') throw new RuntimeException('Reserva concurrente del RUT. Vuelva a validar e intente nuevamente.',409);
            if ($e instanceof PDOException && (str_contains($e->getMessage(),'uq_cliente_ciclo_rut') || str_contains($e->getMessage(),'cliente_ciclo_comercial.rut_bloqueado'))) throw new RuntimeException(ClienteCiclosService::MENSAJE_BLOQUEADO,409);
            if ($e instanceof PDOException && str_contains($e->getMessage(), 'uq_cliente_ficha_origen_activo')) throw new RuntimeException('Ya existe una Ficha de Cliente activa derivada de este Prospecto.',409);
            if ($e instanceof PDOException && str_contains($e->getMessage(), 'uq_cliente_solicitud_rut_activo')) {
                throw new RuntimeException('Ya existe otra solicitud activa del mismo tipo con este RUT.', 409);
            }
            throw $e;
        }
        }
    }

    private function history(array $row, array $user, string $action, ?string $previous, string $comment = '', array $data = []): void
    {
        $this->execute('INSERT INTO cliente_solicitud_historial
            (solicitud_id,accion,estado_anterior,estado_nuevo,usuario_id,usuario_nombre,comentario,datos_evento,creado_en)
            VALUES (?,?,?,?,?,?,?,?,?)', [$row['id'],$action,$previous,$row['estado'],$this->id($user),
                $user['nombre'] ?? '',$comment,json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),$this->ciclos->ahora()->format('Y-m-d H:i:s')]);
    }

    private function validate(array $body, array $user, bool $send, int $id, string $tipo): array
    {
        $data = [];
        foreach (self::CAMPOS as $field => $max) {
            if (isset($body[$field]) && !is_scalar($body[$field])) throw new RuntimeException('Campo inválido: ' . $field, 422);
            $value = trim((string)($body[$field] ?? ''));
            if (mb_strlen($value) > $max) throw new RuntimeException('Campo demasiado largo: ' . $field, 422);
            $required = $tipo === 'FICHA' ? in_array($field,['codigo_vendedor','rut_original','razon_social'],true) : $field !== 'observacion_vendedor';
            if ($send && $required && $value === '') throw new RuntimeException('Campo obligatorio: ' . $field, 422);
            $data[$field] = $value;
        }
        $codes = $this->rows('SELECT cod_vendedor FROM usuario_vendedor WHERE usuario_id=? AND cod_vendedor=?', [$this->id($user),$data['codigo_vendedor']]);
        if (!$codes) throw new RuntimeException('El código vendedor no pertenece al usuario autenticado.', 403);
        $data['rut_normalizado'] = $data['rut_original'] === '' ? '' : self::normalizarRut($data['rut_original']);
        if ($data['contacto_email'] !== '' && !filter_var($data['contacto_email'], FILTER_VALIDATE_EMAIL)) throw new RuntimeException('Correo de contacto inválido.', 422);
        if ($send && !filter_var($user['email'] ?? '', FILTER_VALIDATE_EMAIL)) throw new RuntimeException('Su usuario debe tener un correo válido antes de enviar.', 422);
        if ($data['rut_normalizado'] !== '' && $this->rows("SELECT id FROM cliente_solicitud WHERE tipo=?
            AND rut_normalizado=? AND estado IN ('BORRADOR','PENDIENTE','EN_REVISION','OBSERVADA') AND id<>?", [$tipo,$data['rut_normalizado'],$id])) {
            throw new RuntimeException(ClienteCiclosService::MENSAJE_BLOQUEADO, 409);
        }
        return $data;
    }

    private function nextCorrelativo(string $tipo): string
    {
        $year = (int)date('Y');
        if ($this->db->mysql()->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql') {
            $this->execute('INSERT INTO cliente_solicitud_secuencia (tipo,anio,ultimo) VALUES (?,?,0) ON DUPLICATE KEY UPDATE anio=anio', [$tipo,$year]);
            $row = $this->rows('SELECT ultimo FROM cliente_solicitud_secuencia WHERE tipo=? AND anio=? FOR UPDATE', [$tipo,$year])[0];
        } else {
            $this->execute('INSERT OR IGNORE INTO cliente_solicitud_secuencia (tipo,anio,ultimo) VALUES (?,?,0)', [$tipo,$year]);
            $row = $this->rows('SELECT ultimo FROM cliente_solicitud_secuencia WHERE tipo=? AND anio=?', [$tipo,$year])[0];
        }
        $next = (int)$row['ultimo'] + 1;
        $this->execute('UPDATE cliente_solicitud_secuencia SET ultimo=? WHERE tipo=? AND anio=?', [$next,$tipo,$year]);
        return sprintf('%s-%d-%05d', $tipo === 'FICHA' ? 'CLI' : 'PRO', $year, $next);
    }

    private function fichaData(array $body, bool $send, bool $internal = false, array $old = []): array
    {
        $data = [];
        foreach (($internal ? self::INTERNOS : self::FICHA) as $key => $spec) {
            $value = $body[$key] ?? '';
            if (!is_scalar($value) && $value !== null) throw new RuntimeException('Campo inválido: ' . $spec[0],422);
            $value = trim((string)$value);
            if (mb_strlen($value)>(!$internal && in_array($key,['origen_canal','rubro','forma_pago'],true) ? max(64,$spec[1]) : $spec[1]) || ($send && $spec[2] && $value==='')) throw new RuntimeException('Revise el campo: ' . $spec[0],422);
            $format = $spec[3] ?? null;
            if ($value !== '' && is_array($format) && !in_array($value,$format,true)) throw new RuntimeException('Opción inválida: ' . $spec[0],422);
            if ($value !== '' && $format === 'email' && !filter_var($value,FILTER_VALIDATE_EMAIL)) throw new RuntimeException('Correo inválido: ' . $spec[0],422);
            if ($value !== '' && $format === 'url' && (!filter_var($value,FILTER_VALIDATE_URL) || !in_array(strtolower((string)parse_url($value,PHP_URL_SCHEME)),['http','https'],true))) throw new RuntimeException('Sitio web inválido.',422);
            if ($value !== '' && $format === 'date') {
                $date = DateTimeImmutable::createFromFormat('!Y-m-d',$value);
                if (!$date || $date->format('Y-m-d') !== $value) throw new RuntimeException('Fecha inválida.',422);
            }
            if ($value !== '' && $format === 'month' && !preg_match('/^\d{4}-(0[1-9]|1[0-2])$/D',$value)) throw new RuntimeException('Mes inválido.',422);
            if ($key === 'rut_titular_cuenta_referencia' && $value !== '') $value = self::normalizarRut($value);
            $data[$key] = $key === 'ultima_compra' && $value === '' ? null : $value;
        }
        if (!$internal) foreach (self::CATALOGOS as $tipo => [$field,$codeField]) {
            $value = $data[$field];
            // Conservar el snapshot exacto al guardar sin cambiar la selección histórica.
            if ($old && ($value === ($old[$field] ?? '') || (!empty($old[$codeField]) && $value === $old[$codeField]))) {
                $data[$field] = $old[$field];
                $data[$codeField] = $old[$codeField] ?? null;
                continue;
            }
            if ($value === '') { $data[$codeField] = null; continue; }
            $lock = $this->db->mysql()->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? ' FOR UPDATE' : '';
            $catalog = $this->rows('SELECT * FROM cliente_solicitud_catalogo WHERE tipo=? AND (codigo=? OR nombre=?)' . $lock,[$tipo,$value,$value]);
            if (count($catalog) !== 1 || !(int)$catalog[0]['activo']) throw new RuntimeException('Opción de catálogo inválida o inactiva: ' . self::FICHA[$field][0],422);
            $data[$field] = $catalog[0]['nombre'];
            $data[$codeField] = $catalog[0]['codigo'];
            $this->execute('UPDATE cliente_solicitud_catalogo SET usado_en=COALESCE(usado_en,CURRENT_TIMESTAMP) WHERE id=?',[$catalog[0]['id']]);
        }
        if (!$internal && $send && (($data['rubro_codigo'] ?? '')==='OTROS' || (empty($data['rubro_codigo']) && $data['rubro']==='Otros')) && $data['rubro_otro']==='') throw new RuntimeException('Debe especificar otro rubro.',422);
        return $data;
    }

    private function storeFicha(int $id, array $data, bool $exists): void
    {
        if ($exists) {
            $set = implode(',',array_map(static fn($key)=>$key . '=?',array_keys($data)));
            $this->execute('UPDATE cliente_solicitud_ficha SET ' . $set . ',actualizado_en=CURRENT_TIMESTAMP WHERE solicitud_id=?',[...array_values($data),$id]);
        } else {
            $this->execute('INSERT INTO cliente_solicitud_ficha (solicitud_id,' . implode(',',array_keys($data)) . ') VALUES (' . implode(',',array_fill(0,count($data)+1,'?')) . ')',[$id,...array_values($data)]);
        }
    }

    private function save(array $user, array $body, int $id, bool $send, string $tipo = 'PROSPECTO'): array
    {
        $this->access($user, 'ventas');
        // La expiración defensiva se confirma antes de la transacción de guardado.
        $rutInput=$body['rut_original']??null;
        if(is_scalar($rutInput)&&trim((string)$rutInput)!==''){
            $rut=self::normalizarRut((string)$rutInput);$this->procesarRechazos(false,$rut);$this->ciclos->expirar($rut);
        }
        $row = $this->transaction(function () use ($user,$body,$id,$send,$tipo) {
            $old = $id ? $this->solicitud($id,$user,false,true) : null;
            if ($old && $old['tipo'] !== $tipo) throw new RuntimeException('Tipo de solicitud incorrecto.',404);
            if ($old && !in_array($old['estado'], ['BORRADOR','OBSERVADA'], true)) throw new RuntimeException('La solicitud ya no permite edición.', 409);
            $origin = null;
            if (!$old && $tipo === 'FICHA' && !empty($body['solicitud_origen_id'])) {
                $origin = $this->solicitud((int)$body['solicitud_origen_id'],$user,false,true);
                if ($origin['tipo'] !== 'PROSPECTO' || $origin['estado'] !== 'COMPLETADA') throw new RuntimeException('La Ficha requiere un Prospecto propio completado.',409);
                if ($this->rows("SELECT id FROM cliente_solicitud WHERE tipo='FICHA' AND solicitud_origen_id=? AND estado IN ('BORRADOR','PENDIENTE','EN_REVISION','OBSERVADA')",[$origin['id']])) throw new RuntimeException('Ya existe una Ficha de Cliente activa derivada de este Prospecto.',409);
                $body = array_replace(array_intersect_key($origin,self::CAMPOS),$body);
                $body['rut_original'] = $origin['rut_original'];
            }
            if ($old && !empty($old['solicitud_origen_id']) && isset($body['rut_original']) && self::normalizarRut((string)$body['rut_original']) !== $old['rut_normalizado']) throw new RuntimeException('El RUT heredado del Prospecto no puede modificarse.',422);
            $ficha = null;
            if ($tipo === 'FICHA') {
                $input = $body['ficha'] ?? [];
                if (!is_array($input)) throw new RuntimeException('Datos de Ficha inválidos.',422);
                if (array_intersect_key($input,self::INTERNOS)) throw new RuntimeException('Los campos internos solo pueden ser modificados por Cobranza.',403);
                $defaults = [];
                if ($origin) $defaults += ['encargado_compras'=>$origin['contacto_nombre'],'email_compras'=>$origin['contacto_email'],
                    'telefono_compras'=>$origin['telefono'],'telefono_empresa'=>$origin['telefono'],'linea_productos'=>$origin['productos_interes']];
                $ficha = $this->fichaData(array_replace($old['ficha'] ?? $defaults,$input),$send,false,$old['ficha'] ?? []);
                $body['contacto_nombre']=$ficha['encargado_compras'];$body['contacto_email']=$ficha['email_compras'];
                $body['telefono']=$ficha['telefono_compras'] ?: $ficha['telefono_empresa'];$body['productos_interes']=$ficha['linea_productos'];
            }
            $data = $this->validate(array_replace($old ?? [],$body),$user,$send,$id,$tipo);
            $cycleId=$this->ciclos->reservar($data,$user,$old,$origin,$send);
            if($cycleId)$data['ciclo_comercial_id']=$cycleId;
            if($cycleId&&!$old){$known=$this->ciclos->obtener($cycleId,$user);if($known['codigo_auxiliar_softland'])$data['codigo_auxiliar_softland']=$known['codigo_auxiliar_softland'];}
            $data['estado'] = $send ? 'PENDIENTE' : 'BORRADOR';
            $data['actualizado_en'] = date('Y-m-d H:i:s');
            if (!$old) {
                $data['tipo'] = $tipo;
                $previous=$this->rows("SELECT id FROM cliente_solicitud WHERE rut_normalizado=? AND estado='RECHAZADA' AND rechazo_definitivo=1 ORDER BY id DESC LIMIT 1",[$data['rut_normalizado']])[0]??null;
                if(!empty($body['solicitud_anterior_id'])){
                    if(filter_var($body['solicitud_anterior_id'],FILTER_VALIDATE_INT,['options'=>['min_range'=>1]])===false)throw new RuntimeException('Solicitud anterior inválida.',422);
                    $previous=$this->rows("SELECT id FROM cliente_solicitud WHERE id=? AND rut_normalizado=? AND estado='RECHAZADA' AND rechazo_definitivo=1",[(int)$body['solicitud_anterior_id'],$data['rut_normalizado']])[0]??null;
                    if(!$previous)throw new RuntimeException('La solicitud anterior no corresponde a un rechazo definitivo del mismo RUT.',422);
                }
                if($previous)$data['solicitud_anterior_id']=$previous['id'];
                if ($origin) {
                    $data['solicitud_origen_id'] = $origin['id'];
                    $data['codigo_auxiliar_softland'] = $origin['codigo_auxiliar_softland'];
                }
                $data['usuario_vendedor_id'] = $this->id($user);
                $data['vendedor_nombre'] = (string)($origin['vendedor_nombre'] ?? $user['nombre'] ?? '');
                $data['vendedor_email'] = (string)($origin['vendedor_email'] ?? $user['email'] ?? '');
            }
            if ($send) {
                $data['correlativo'] = $old['correlativo'] ?? $this->nextCorrelativo($tipo);
                $data['enviado_en'] = date('Y-m-d H:i:s');
            }
            if ($old) {
                $set = implode(',', array_map(static fn($key) => $key . '=?', array_keys($data)));
                $this->execute('UPDATE cliente_solicitud SET ' . $set . ' WHERE id=?', [...array_values($data),$id]);
            } else {
                $this->execute('INSERT INTO cliente_solicitud (' . implode(',',array_keys($data)) . ') VALUES (' . implode(',',array_fill(0,count($data),'?')) . ')', array_values($data));
                $id = (int)$this->db->mysql()->lastInsertId();
            }
            if ($ficha !== null) $this->storeFicha($id,$ficha,$old !== null);
            if($cycleId)$this->ciclos->vincular($cycleId,$id);
            $row = $this->solicitud($id,$user);
            if(!$old&&!empty($data['solicitud_anterior_id']))$this->history($row,$user,'NUEVO_INGRESO_DESDE_RECHAZADA',null,'Nuevo ingreso sin modificar la solicitud anterior.',['solicitud_anterior_id'=>$data['solicitud_anterior_id']]);
            if (!$old && ($tipo !== 'FICHA' || $send || $origin)) $this->history($row,$user,$origin ? 'FICHA_CREADA_DESDE_PROSPECTO' : 'CREADA',null,'',['solicitud_origen_id'=>$origin['id'] ?? null]);
            $action = $tipo === 'FICHA'
                ? ($send ? (!empty($old['enviado_en']) ? 'REENVIADA' : 'FICHA_ENVIADA') : ($old ? 'FICHA_BORRADOR_ACTUALIZADA' : 'FICHA_BORRADOR_CREADA'))
                : ($send ? (!empty($old['enviado_en']) ? 'REENVIADA' : 'ENVIADA') : 'BORRADOR_GUARDADO');
            $this->history($row,$user,$action,$old['estado'] ?? null,'',['campos'=>$data,'ficha'=>$ficha]);
            return $row;
        });
        return ['ok'=>true,'solicitud'=>$row,'correo'=>$send ? $this->notify($row,'enviar') : ['estado'=>'no_aplica']];
    }

    private function process(array $user, int $id, string $action, array $body): array
    {
        $this->access($user,'gestion');
        $row = $this->transaction(function () use ($user,$id,$action,$body) {
            $old = $this->solicitud($id,$user,true,true);
            if($old['apelacion_en_tramite'])throw new RuntimeException('Debe resolver la apelación antes de continuar la revisión.',409);
            $allowed = $action === 'revision' ? ['PENDIENTE'] : ['PENDIENTE','EN_REVISION'];
            if (!in_array($old['estado'],$allowed,true)) throw new RuntimeException('La transición no está permitida desde ' . $old['estado'],409);
            $comment = trim((string)($body['comentario'] ?? ''));
            if (mb_strlen($comment) > 4000) throw new RuntimeException('El comentario excede 4000 caracteres.',422);
            if ($action === 'observar' && $comment === '') throw new RuntimeException('Debe indicar un comentario para observar.',422);
            $state = ['revision'=>'EN_REVISION','observar'=>'OBSERVADA','completar'=>'COMPLETADA'][$action];
            $data = ['estado'=>$state,'actualizado_en'=>date('Y-m-d H:i:s')];
            if ($action === 'completar') {
                $code = trim((string)($body['codigo_auxiliar_softland'] ?? ''));
                if ($code === '' || mb_strlen($code) > 30) throw new RuntimeException('Debe indicar un código auxiliar Softland válido (máximo 30 caracteres).',422);
                $consulta=$old['prodin_consulta']??null;$different=false;
                if($consulta){
                    if(isset($body['prodin_consulta_id'])&&(int)$body['prodin_consulta_id']!==$consulta['id_consulta'])throw new RuntimeException('La consulta PRODIN cambió. Actualice y revise el auxiliar antes de completar.',409);
                    if(count($consulta['auxiliares'])>1&&empty($consulta['seleccionado']))throw new RuntimeException('Seleccione explícitamente un auxiliar de las coincidencias por RUT antes de completar.',409);
                    $different=!empty($consulta['seleccionado'])&&$code!==$consulta['seleccionado'];
                    if($different&&(($body['confirmar_codaux_diferente']??false)!==true||(int)($body['prodin_consulta_id']??0)!==$consulta['id_consulta']))throw new RuntimeException('El CodAux ingresado difiere del propuesto por RUT. Confirme expresamente la excepción.',409);
                }
                $data += ['codigo_auxiliar_softland'=>$code,'procesado_por'=>$this->id($user),
                    'procesado_por_nombre'=>$user['nombre'] ?? '', 'completado_en'=>date('Y-m-d H:i:s')];
                if ($old['tipo'] === 'FICHA') {
                    $input = $body['ficha_interna'] ?? [];
                    if (!is_array($input)) throw new RuntimeException('Datos internos inválidos.',422);
                    $internal = $this->fichaData(array_replace($old['ficha'],$input),false,true);
                    $this->storeFicha($id,$internal,true);
                }
            }
            $set = implode(',', array_map(static fn($key) => $key . '=?', array_keys($data)));
            $this->execute('UPDATE cliente_solicitud SET ' . $set . ' WHERE id=?', [...array_values($data),$id]);
            $row = $this->solicitud($id,$user,true);
            if($action==='completar')$this->ciclos->iniciar($row,$user);
            $row = $this->solicitud($id,$user,true);
            $actionName = ['revision'=>'REVISION_INICIADA','observar'=>'OBSERVADA','completar'=>'COMPLETADA'][$action];
            $this->history($row,$user,$actionName,$old['estado'],$comment,$data + ['ficha_interna'=>$internal ?? null]);
            if($action==='completar'&&!empty($different))$this->history($row,$user,'CODAUX_DISTINTO_PROPUESTO',$old['estado'],'Cobranzas confirmó un CodAux diferente al encontrado por RUT.',['consulta_id'=>$consulta['id_consulta'],'codigo_propuesto'=>$consulta['seleccionado'],'codigo_confirmado'=>$row['codigo_auxiliar_softland']]);
            return $row;
        });
        return ['ok'=>true,'solicitud'=>$row,'correo'=>$action === 'revision' ? ['estado'=>'no_aplica'] : $this->notify($row,$action)];
    }

    private function consultaProdinGuardada(array $row): ?array
    {
        $event=$this->rows("SELECT id,datos_evento FROM cliente_solicitud_historial WHERE solicitud_id=? AND accion='PRODIN_RUT_CONSULTADO' ORDER BY id DESC LIMIT 1",[$row['id']])[0]??null;
        if(!$event)return null;$data=json_decode((string)$event['datos_evento'],true);
        if(!is_array($data)||($data['rut_normalizado']??null)!==$row['rut_normalizado'])return null;
        return $data+['id_consulta'=>(int)$event['id']];
    }
    private function referenciaHistorica(array $row): array
    {
        $start=$row['ciclo']['inicio_gestion']??null;
        return ['referencia_historica'=>$start?:$this->ciclos->ahora()->format('Y-m-d'),'referencia_provisional'=>empty($start)];
    }
    private function consultarProdinRut(array $user,int $id,array $body): array
    {
        $row=$this->solicitud($id,$user,true);$activity=new ClienteActividadSoftlandService($this->db);
        $rut=self::normalizarRut($row['rut_original']);$candidates=$activity->resolverRut($rut);
        $selected=null;
        if(isset($body['codigo_auxiliar'])&&(!is_string($body['codigo_auxiliar'])||trim($body['codigo_auxiliar'])===''))throw new RuntimeException('Seleccione un código auxiliar válido.',422);
        $requested=isset($body['codigo_auxiliar'])?trim($body['codigo_auxiliar']):null;
        if($requested!==null){foreach($candidates as $candidate)if($candidate['codigo_auxiliar']===$requested)$selected=$requested;if($selected===null)throw new RuntimeException('El auxiliar seleccionado no corresponde al RUT de la solicitud.',422);}
        elseif(count($candidates)===1)$selected=$candidates[0]['codigo_auxiliar'];
        $reference=$this->referenciaHistorica($row);
        $summary=$selected!==null?$activity->resumenHistorico(['codigo_auxiliar_softland'=>$selected,'inicio_gestion'=>$reference['referencia_historica']]):null;
        $context=['rut_normalizado'=>$rut,'auxiliares'=>$candidates,'seleccionado'=>$selected]+$reference;
        $context=$this->transaction(function()use($user,$id,$rut,$context,$reference){
            $fresh=$this->solicitud($id,$user,true,true);
            if($fresh['rut_normalizado']!==$rut||$this->referenciaHistorica($fresh)!==$reference)throw new RuntimeException('La solicitud cambió durante la consulta PRODIN. Vuelva a comprobarla.',409);
            $this->history($fresh,$user,'PRODIN_RUT_CONSULTADO',$fresh['estado'],'Consulta explícita del maestro de auxiliares por RUT.',$context);
            return $context+['id_consulta'=>(int)$this->db->mysql()->lastInsertId()];
        });
        return ['ok'=>true,'consulta'=>$context,'resumen_historico'=>$summary];
    }
    private function historiaProdinSolicitud(array $user,int $id,string $action,?int $number,array $query): array
    {
        $row=$this->solicitud($id,$user,true);$context=$row['prodin_consulta'];
        if(!$context||empty($context['seleccionado']))throw new RuntimeException('Compruebe el RUT y seleccione un auxiliar antes de consultar sus documentos.',409);
        $code=(string)($query['codigo_auxiliar']??$context['seleccionado']);
        if($code!==$context['seleccionado']||!in_array($code,array_column($context['auxiliares'],'codigo_auxiliar'),true))throw new RuntimeException('El auxiliar histórico no corresponde a la selección registrada para esta solicitud.',403);
        $reference=$this->referenciaHistorica($row);$c=['codigo_auxiliar_softland'=>$code,'inicio_gestion'=>$reference['referencia_historica'],'usuario_vendedor_id'=>$row['usuario_vendedor_id']];$activity=new ClienteActividadSoftlandService($this->db);
        if($action==='resumen')$result=$activity->resumenHistorico($c);
        elseif($action==='documentos')$result=$activity->historicos($c,(int)($query['pagina']??1),isset($query['tipo'])?(string)$query['tipo']:null);
        else {if(!$number)throw new RuntimeException('Seleccione un documento específico.',422);$result=$activity->documentos($c,$action,true,$number,true);}
        return $result+$reference+['codigo_auxiliar'=>$code];
    }

    private function publicarSolicitud(array $row): array
    {
        $now=$this->ciclos->ahora();$until=empty($row['apelable_hasta'])?null:new DateTimeImmutable($row['apelable_hasta'],$now->getTimezone());
        $row['puede_apelar']=$row['estado']==='RECHAZADA'&&empty($row['rechazo_definitivo'])&&empty($row['apelada_en'])&&$until!==null&&$now<=$until;
        $row['apelacion_en_tramite']=$row['estado']==='EN_REVISION'&&($row['apelacion_resultado']??null)==='PENDIENTE'&&!empty($row['apelada_en']);
        $row['apelacion_dias_restantes']=$until?(int)$now->setTime(0,0)->diff($until->setTime(0,0))->format('%r%a'):null;
        return $row;
    }
    private function comentario(array $body,bool $required=true): string
    {
        if(isset($body['comentario'])&&!is_string($body['comentario']))throw new RuntimeException('Comentario inválido.',422);
        $text=trim((string)($body['comentario']??''));
        if(($required&&$text==='')||mb_strlen($text)>4000)throw new RuntimeException('Ingrese un comentario de hasta 4000 caracteres.',422);
        return $text;
    }
    private function actualizarRechazo(int $id,array $data): void
    {
        $data['actualizado_en']=$this->ciclos->ahora()->format('Y-m-d H:i:s');
        $this->execute('UPDATE cliente_solicitud SET '.implode(',',array_map(static fn($key)=>$key.'=?',array_keys($data))).' WHERE id=?',[...array_values($data),$id]);
    }
    private function rechazo(array $user,int $id,string $action,array $body): array
    {
        $global=$action!=='apelar';$this->access($user,$global?'gestion':'ventas');
        $row=$this->transaction(function()use($user,$id,$action,$body,$global){
            $old=$this->solicitud($id,$user,$global,true);$now=$this->ciclos->ahora();$date=$now->format('Y-m-d H:i:s');
            $comment=$this->comentario($body,!in_array($action,['aceptar-apelacion','confirmar-rechazo'],true));$data=[];
            if($action==='rechazar'){
                if(!in_array($old['estado'],['PENDIENTE','EN_REVISION'],true)||$old['apelacion_en_tramite'])throw new RuntimeException('No se puede rechazar en esta etapa; resuelva la apelación pendiente si corresponde.',409);
                $code=$body['motivo_codigo']??'';if(!is_string($code))throw new RuntimeException('Motivo inválido.',422);
                $lock=$this->db->mysql()->getAttribute(PDO::ATTR_DRIVER_NAME)==='mysql'?' FOR UPDATE':'';
                $reason=$this->rows("SELECT * FROM cliente_solicitud_catalogo WHERE tipo='MOTIVO_RECHAZO' AND codigo=? AND activo=1".$lock,[$code])[0]??null;
                if(!$reason)throw new RuntimeException('Seleccione un motivo de rechazo activo.',422);
                // Un registro anterior sin ciclo se regulariza únicamente al operar sobre él, nunca en lote.
                if(empty($old['ciclo_comercial_id'])){
                    $cid=$this->ciclos->reservar($old,['id'=>$old['usuario_vendedor_id']],$old,null,true);
                    $this->actualizarRechazo($id,['ciclo_comercial_id'=>$cid]);if($cid)$this->ciclos->vincular($cid,$id);$old['ciclo_comercial_id']=$cid;
                }
                $definitive=!empty($old['apelada_en']);
                $data=['estado'=>'RECHAZADA','rechazo_motivo_codigo'=>$reason['codigo'],'rechazo_motivo_texto'=>$reason['nombre'],'rechazo_comentario'=>$comment,'rechazado_por'=>$this->id($user),'rechazado_por_nombre'=>$user['nombre']??'','rechazado_en'=>$date,'rechazo_definitivo'=>$definitive?1:0];
                if(!$definitive)$data+=['apelable_hasta'=>$now->modify('+7 days')->format('Y-m-d H:i:s'),'apelada_en'=>null,'apelacion_comentario'=>null,'apelacion_resultado'=>null,'apelacion_resuelta_en'=>null];
                else $data+=['apelacion_resultado'=>'RECHAZADA','apelacion_resuelta_en'=>$date];
                $this->execute('UPDATE cliente_solicitud_catalogo SET usado_en=COALESCE(usado_en,?) WHERE id=?',[$date,$reason['id']]);$event='RECHAZADA';
            }elseif($action==='apelar'){
                if(!$old['puede_apelar'])throw new RuntimeException('El plazo venció o esta solicitud ya utilizó su única apelación.',409);
                $data=['estado'=>'EN_REVISION','apelada_en'=>$date,'apelacion_comentario'=>$comment,'apelacion_resultado'=>'PENDIENTE'];$event='APELACION_ENVIADA';
            }else{
                if(!$old['apelacion_en_tramite'])throw new RuntimeException('No existe apelación pendiente de resolución.',409);
                $accepted=$action==='aceptar-apelacion';
                $data=['estado'=>$accepted?'EN_REVISION':'RECHAZADA','apelacion_resultado'=>$accepted?'ACEPTADA':'RECHAZADA','apelacion_resuelta_en'=>$date,'rechazo_definitivo'=>$accepted?0:1];
                $event=$accepted?'APELACION_ACEPTADA':'APELACION_RECHAZADA';
            }
            $this->actualizarRechazo($id,$data);$row=array_replace($old,$data);
            $this->history($row,$user,$event,$old['estado'],$comment,['motivo_codigo'=>$row['rechazo_motivo_codigo']??null,'motivo_texto'=>$row['rechazo_motivo_texto']??null,'apelable_hasta'=>$row['apelable_hasta']??null,'rechazo_definitivo'=>$row['rechazo_definitivo']??0]);
            if(!empty($row['rechazo_definitivo'])&&!empty($row['ciclo_comercial_id']))$this->ciclos->liberarTramiteRechazado((int)$row['ciclo_comercial_id']);
            return $this->solicitud($id,$user,$global);
        });
        return ['ok'=>true,'solicitud'=>$row,'correo'=>$this->notify($row,$action)];
    }
    public function procesarRechazos(bool $dry=false,?string $rut=null): array
    {
        return $this->transaction(function()use($dry,$rut){
            $where="estado='RECHAZADA' AND rechazo_definitivo=0 AND apelada_en IS NULL AND apelable_hasta<?";$params=[$this->ciclos->ahora()->format('Y-m-d H:i:s')];
            if($rut!==null){$where.=' AND rut_normalizado=?';$params[]=$rut;}
            $lock=!$dry&&$this->db->mysql()->getAttribute(PDO::ATTR_DRIVER_NAME)==='mysql'?' FOR UPDATE':'';
            $rows=$this->rows('SELECT * FROM cliente_solicitud WHERE '.$where.' ORDER BY id'.$lock,$params);
            if(!$dry)foreach($rows as $old){
                $this->actualizarRechazo((int)$old['id'],['rechazo_definitivo'=>1]);$row=array_replace($old,['rechazo_definitivo'=>1]);
                $this->history($row,['id'=>0,'nombre'=>'Proceso C&P'],'RECHAZO_DEFINITIVO_POR_PLAZO','RECHAZADA','Plazo de siete días vencido sin apelación.');
                if(!empty($old['ciclo_comercial_id']))$this->ciclos->liberarTramiteRechazado((int)$old['ciclo_comercial_id']);
            }
            return ['rechazos_definitivos'=>count($rows),'dry_run'=>$dry];
        });
    }
    private function reabrir(array $user,int $id,array $body): array
    {
        $this->access($user,'gestion');$comment=$this->comentario($body);
        return $this->transaction(function()use($user,$id,$comment){
            $old=$this->solicitud($id,$user,true,true);
            if($old['estado']!=='RECHAZADA')throw new RuntimeException('Solo se reabre un rechazo mediante un nuevo ingreso relacionado.',409);
            if(empty($old['rechazo_definitivo'])){
                $this->actualizarRechazo($id,['rechazo_definitivo'=>1]);
                if(!empty($old['ciclo_comercial_id']))$this->ciclos->liberarTramiteRechazado((int)$old['ciclo_comercial_id']);
            }
            $owner=$this->rows('SELECT id,nombre,email FROM usuario WHERE id=? AND is_active=1',[$old['usuario_vendedor_id']])[0]??null;
            if(!$owner)throw new RuntimeException('El vendedor de origen ya no está activo.',422);
            $owner['menus']=[['codigo'=>'ventas_clientes_prospectos']];$input=array_intersect_key($old,self::CAMPOS);
            $input['solicitud_anterior_id']=$id;
            if($old['tipo']==='FICHA'){
                $input['ficha']=array_intersect_key($old['ficha'],self::FICHA);
                foreach(self::CATALOGOS as [$field])$input['ficha'][$field]='';
                if($old['solicitud_origen_id'])$input['solicitud_origen_id']=$old['solicitud_origen_id'];
            }
            $result=$this->save($owner,$input,0,false,$old['tipo']);$new=$result['solicitud'];
            $event=['solicitud_anterior_id'=>$id,'nueva_solicitud_id'=>$new['id']];
            $this->history($old,$user,'REAPERTURA_ADMINISTRATIVA','RECHAZADA',$comment,$event);$this->history($new,$user,'REAPERTURA_ADMINISTRATIVA',null,$comment,$event);
            return ['ok'=>true,'solicitud'=>$this->solicitud((int)$new['id'],$user,true)];
        });
    }

    public function destinatarios(string $tipo = 'PROSPECTO'): array
    {
        $column = $tipo === 'FICHA' ? 'recibe_ficha' : 'recibe_prospecto';
        return array_column($this->rows('SELECT email FROM cliente_solicitud_responsable WHERE activo=1 AND ' . $column . '=1 AND recibe_correo=1'),'email');
    }

    public function prepararCorreo(array $row, string $event): array
    {
        $logical = in_array($event,['enviar','apelar'],true) ? $this->destinatarios($row['tipo']) : [$row['vendedor_email']];
        $test = strtolower((string)env('CLIENT_SOLICITUD_MAIL_TEST_MODE','false')) === 'true';
        $recipients = $logical;
        if ($test) {
            $target = strtolower(trim((string)env('CLIENT_SOLICITUD_MAIL_TEST_RECIPIENT')));
            if ($target === '') throw new RuntimeException('CLIENT_SOLICITUD_MAIL_TEST_RECIPIENT no configurado.',422);
            if ($target !== 'arivera@texpro.cl') throw new RuntimeException('Modo TEST permitido únicamente para arivera@texpro.cl.',422);
            $recipients = [$target];
        }
        $name = $row['tipo'] === 'FICHA' ? 'Ficha Cliente' : 'Prospecto';
        $title = ['enviar'=>'Nueva solicitud de ' . $name,'observar'=>'Solicitud de ' . $name . ' observada','completar'=>'Solicitud de ' . $name . ' completada','rechazar'=>'Solicitud rechazada','apelar'=>'Apelación enviada','aceptar-apelacion'=>'Apelación aceptada','confirmar-rechazo'=>'Apelación rechazada'][$event];
        $subject = ($test ? '[LOCAL TEST] ' : '') . $title . ' ' . $row['correlativo'];
        $lines = [$subject,'Vendedor: ' . $row['vendedor_nombre'],'Código vendedor: ' . $row['codigo_vendedor'],'Cliente: ' . $row['razon_social'],'RUT: ' . $row['rut_original']];
        if ($test) $lines[] = 'Destinatario lógico original: ' . implode(', ',$logical);
        if ($event === 'completar') { $lines[] = 'Código auxiliar Softland: ' . $row['codigo_auxiliar_softland']; $lines[] = 'Ya puede continuar el proceso CRM en Softland.'; }
        if ($event === 'observar') $lines[] = 'Observación: ' . ($this->rows("SELECT comentario FROM cliente_solicitud_historial WHERE solicitud_id=? AND accion='OBSERVADA' ORDER BY id DESC LIMIT 1",[$row['id']])[0]['comentario'] ?? '');
        if(in_array($event,['rechazar','apelar','aceptar-apelacion','confirmar-rechazo'],true))foreach(['rechazo_motivo_texto'=>'Motivo','rechazo_comentario'=>'Comentario del rechazo','rechazado_en'=>'Fecha rechazo','apelable_hasta'=>'Apelable hasta','apelacion_comentario'=>'Fundamento apelación','apelacion_resultado'=>'Resolución'] as $key=>$label)if(!empty($row[$key]))$lines[]=$label.': '.$row[$key];
        $path = in_array($event,['enviar','apelar'],true) ? 'cobranza' : 'ventas';
        $url = rtrim((string)env('FRONTEND_URL','http://localhost:8000'),'/') . '/src/modulo/' . $path . '/clientes-prospectos/index.html?solicitud=' . $row['id'];
        $html = implode('',array_map(static fn($line)=>'<p>' . htmlspecialchars($line,ENT_QUOTES,'UTF-8') . '</p>',$lines));
        $html .= '<p><a href="' . htmlspecialchars($url,ENT_QUOTES,'UTF-8') . '">Abrir en GICOTEX</a></p>';
        return ['destinatarios'=>$recipients,'destinatarios_logicos'=>$logical,'asunto'=>$subject,'html'=>$html];
    }

    private function notify(array $row, string $event): array
    {
        if (strtolower((string)env('CLIENT_SOLICITUD_MAIL_ENABLED','false')) !== 'true') {
            error_log('Clientes Prospectos: correo omitido por configuración local. Solicitud ' . $row['id']);
            return ['estado'=>'omitido','mensaje'=>'Correo omitido por CLIENT_SOLICITUD_MAIL_ENABLED=false.'];
        }
        try {
            $mail = $this->prepararCorreo($row,$event);
            if (!$mail['destinatarios']) return ['estado'=>'omitido','mensaje'=>'No hay responsables activos con correo habilitado.'];
            $status = (new GraphMailService())->send($mail['destinatarios'],$mail['asunto'],$mail['html']);
            return ['estado'=>'enviado','http_status'=>$status,'destinatarios'=>$mail['destinatarios'],
                'destinatarios_logicos'=>$mail['destinatarios_logicos']];
        } catch (Throwable $e) {
            // La solicitud ya está confirmada: no inducir al usuario a reenviarla.
            error_log('Clientes Prospectos: fallo de correo para solicitud ' . $row['id']);
            return ['estado'=>'error','mensaje'=>'Solicitud guardada; no se pudo enviar el correo.'];
        }
    }

    private function listRequests(array $user, array $query, bool $global): array
    {
        $this->access($user,$global ? 'gestion' : 'ventas');
        $where = ['1=1']; $params = [];
        if (!empty($query['tipo'])) { $where[] = 's.tipo=?'; $params[] = $this->tipo($query['tipo']); }
        if (!$global) { $where[] = 's.usuario_vendedor_id=?'; $params[] = $this->id($user); }
        if ($global && !empty($query['vendedor'])) { $where[] = 's.usuario_vendedor_id=?'; $params[] = (int)$query['vendedor']; }
        if (!empty($query['estado'])) {
            if (!in_array($query['estado'],self::ESTADOS,true)) throw new RuntimeException('Estado inválido.',422);
            $where[] = 's.estado=?'; $params[] = $query['estado'];
        }
        $search = trim((string)($query['buscar'] ?? ''));
        if ($search !== '') {
            $where[] = '(s.razon_social LIKE ? OR s.rut_original LIKE ? OR s.rut_normalizado LIKE ?)';
            $params = [...$params,'%' . $search . '%','%' . $search . '%','%' . str_replace(['.','-'],'',strtoupper($search)) . '%'];
        }
        $end = 'CASE WHEN c.extension_usada=1 THEN c.vence_extension ELSE c.vence_inicial END';
        if (($query['vigencia'] ?? '') === 'POR_VENCER') {
            $where[] = "c.estado IN ('EN_GESTION','EXTENDIDO') AND $end<=?";
            $params[] = $this->ciclos->ahora()->modify('+10 days')->format('Y-m-d');
        }
        $condition = implode(' AND ',$where);
        $page = max(1,(int)($query['pagina'] ?? 1));
        $from = ' FROM cliente_solicitud s LEFT JOIN cliente_ciclo_comercial c ON c.id=s.ciclo_comercial_id AND c.usuario_vendedor_id=s.usuario_vendedor_id';
        $total = (int)$this->rows('SELECT COUNT(*) AS total'.$from.' WHERE '.$condition,$params)[0]['total'];
        $fields = ['id','estado','rut_original','usuario_vendedor_id','solicitud_origen_id','codigo_auxiliar_softland','extension_usada','inicio_gestion','reserva_hasta','vence_inicial','vence_extension','cotizaciones_count','notas_venta_count','facturas_count','factura_conversion_folio'];
        $select = implode(',',array_map(static fn($f)=>'c.'.$f.' AS ciclo_'.$f,$fields));
        $order = ($query['orden']??'')==='vigencia' ? "CASE WHEN c.estado IN ('EN_GESTION','EXTENDIDO') AND ($end) IS NOT NULL THEN 0 ELSE 1 END,($end)," : '';
        $rows = $this->rows('SELECT s.id,s.correlativo,s.tipo,s.estado,s.creado_en,s.usuario_vendedor_id,s.vendedor_nombre,s.codigo_vendedor,s.razon_social,s.rut_original,s.solicitud_origen_id,s.ciclo_comercial_id,s.apelada_en,s.apelacion_resultado,s.apelable_hasta,s.rechazo_definitivo,s.solicitud_anterior_id,
            origen.correlativo AS origen_correlativo,referencia.correlativo AS ciclo_origen_correlativo,'.$select.$from.'
            LEFT JOIN cliente_solicitud origen ON origen.id=s.solicitud_origen_id
            LEFT JOIN cliente_solicitud referencia ON referencia.id=c.solicitud_origen_id
            WHERE '.$condition.' ORDER BY '.$order.'s.creado_en DESC,s.id DESC LIMIT 50 OFFSET '.(($page-1)*50),$params);
        foreach ($rows as &$row) {
            $cycle=[];foreach($fields as $f){$cycle[$f]=$row['ciclo_'.$f];unset($row['ciclo_'.$f]);}
            $row['ciclo']=$cycle['id']!==null?$this->ciclos->publico($cycle,$global):null;
            foreach(['cotizaciones_count','notas_venta_count','facturas_count'] as $f)$row[$f]=(int)($cycle[$f]??0);
            $row=$this->publicarSolicitud($row);
        }unset($row);
        return ['ok'=>true,'solicitudes'=>$rows,'total'=>$total,'pagina'=>$page];
    }

    private function buscarFichaRut(array $user, array $query): array
    {
        $this->access($user,'ventas');
        $rut = self::normalizarRut((string)($query['rut'] ?? ''));
        $active = $this->rows("SELECT id,correlativo,estado,usuario_vendedor_id FROM cliente_solicitud WHERE tipo='FICHA'
            AND rut_normalizado=? AND estado IN ('BORRADOR','PENDIENTE','EN_REVISION','OBSERVADA') AND id<>? LIMIT 1",[$rut,(int)($query['excluir_id'] ?? 0)])[0] ?? null;
        $own = $active && (int)$active['usuario_vendedor_id'] === $this->id($user);
        $origin = $this->rows("SELECT id,correlativo FROM cliente_solicitud WHERE tipo='PROSPECTO' AND estado='COMPLETADA'
            AND rut_normalizado=? AND usuario_vendedor_id=? ORDER BY completado_en DESC,id DESC LIMIT 1",[$rut,$this->id($user)])[0] ?? null;
        if ($active) unset($active['usuario_vendedor_id']);
        return ['ok'=>true,'existe_activa'=>$active !== null,'solicitud'=>$own ? $active : null,'prospecto_completado'=>$origin];
    }

    private function responsables(array $user, string $method, array $body, int $id): array
    {
        $this->access($user,'admin');
        if ($method === 'GET') return ['ok'=>true,'responsables'=>$this->rows('SELECT * FROM cliente_solicitud_responsable ORDER BY nombre')];
        return $this->transaction(function () use ($user,$method,$body,$id) {
            $old = $id ? ($this->rows('SELECT * FROM cliente_solicitud_responsable WHERE id=?',[$id])[0] ?? null) : null;
            if ($id && !$old) throw new RuntimeException('Responsable no encontrado.',404);
            $data = array_replace($old ?? [],$body);
            $name = trim((string)($data['nombre'] ?? '')); $email = strtolower(trim((string)($data['email'] ?? '')));
            if ($name === '' || mb_strlen($name)>255 || strlen($email)>254 || !filter_var($email,FILTER_VALIDATE_EMAIL)) throw new RuntimeException('Nombre y correo válido son obligatorios.',422);
            if ($this->rows('SELECT id FROM cliente_solicitud_responsable WHERE email=? AND id<>?',[$email,$id])) throw new RuntimeException('Ya existe un responsable con ese correo.',409);
            $values = [$name,$email];
            foreach (['recibe_prospecto','recibe_ficha','recibe_correo','activo'] as $key) $values[] = !empty($data[$key]) ? 1 : 0;
            $values[] = $this->id($user);
            if ($id) {
                $this->execute('UPDATE cliente_solicitud_responsable SET nombre=?,email=?,recibe_prospecto=?,recibe_ficha=?,recibe_correo=?,activo=?,actualizado_por=?,actualizado_en=CURRENT_TIMESTAMP WHERE id=?',[...$values,$id]);
            } else {
                $this->execute('INSERT INTO cliente_solicitud_responsable (nombre,email,recibe_prospecto,recibe_ficha,recibe_correo,activo,creado_por,actualizado_por) VALUES (?,?,?,?,?,?,?,?)',[...$values,$this->id($user)]);
                $id = (int)$this->db->mysql()->lastInsertId();
            }
            return ['ok'=>true,'responsable'=>$this->rows('SELECT * FROM cliente_solicitud_responsable WHERE id=?',[$id])[0]];
        });
    }

    private function catalogos(array $user, string $method, array $query, array $body, int $id): array
    {
        if ($method === 'GET') {
            if (!empty($query['todos'])) $this->access($user,'admin');
            else {
                try { $this->access($user,'ventas'); } catch (RuntimeException) { $this->access($user,'gestion'); }
            }
            $tipo = $query['tipo'] ?? '';
            if (!is_string($tipo) || (!isset(self::CATALOGOS[$tipo])&&$tipo!=='MOTIVO_RECHAZO')) throw new RuntimeException('Tipo de catálogo inválido.',422);
            return ['ok'=>true,'catalogos'=>$this->rows('SELECT *,CASE WHEN usado_en IS NULL THEN 1 ELSE 0 END AS puede_eliminar FROM cliente_solicitud_catalogo WHERE tipo=?' . (!empty($query['todos']) ? '' : ' AND activo=1') . ' ORDER BY orden,nombre',[$tipo])];
        }
        $this->access($user,'admin');
        return $this->transaction(function () use ($user,$method,$body,$id) {
            $lock = $this->db->mysql()->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? ' FOR UPDATE' : '';
            $old = $id ? ($this->rows('SELECT * FROM cliente_solicitud_catalogo WHERE id=?' . $lock,[$id])[0] ?? null) : null;
            if ($id && !$old) throw new RuntimeException('Valor de catálogo no encontrado.',404);
            if ($method === 'DELETE') {
                if($old['tipo']==='MOTIVO_RECHAZO')$used=$old['usado_en']||$this->rows('SELECT id FROM cliente_solicitud WHERE rechazo_motivo_codigo=? LIMIT 1',[$old['codigo']]);
                else {[$field,$codeField] = self::CATALOGOS[$old['tipo']];$used = $old['usado_en'] || $this->rows("SELECT solicitud_id FROM cliente_solicitud_ficha WHERE $codeField=? OR ($codeField IS NULL AND ($field=? OR $field=?)) LIMIT 1",[$old['codigo'],$old['codigo'],$old['nombre']]);}
                if ($used) throw new RuntimeException('Este valor ya fue utilizado en solicitudes y no puede eliminarse. Puedes desactivarlo.',409);
                $this->execute('DELETE FROM cliente_solicitud_catalogo WHERE id=?',[$id]);
                return ['ok'=>true];
            }
            $tipo = $old['tipo'] ?? ($body['tipo'] ?? '');
            if (!is_string($tipo) || (!isset(self::CATALOGOS[$tipo])&&$tipo!=='MOTIVO_RECHAZO')) throw new RuntimeException('Tipo de catálogo inválido.',422);
            if (isset($body['codigo']) || (isset($body['tipo']) && $body['tipo'] !== $tipo)) throw new RuntimeException('El código y el tipo no pueden modificarse.',422);
            $data = array_replace($old ?? ['orden'=>0,'activo'=>1],$body);
            $name = $data['nombre'] ?? '';
            $max=$tipo==='MOTIVO_RECHAZO'?120:self::FICHA[self::CATALOGOS[$tipo][0]][1];
            if (!is_string($name) || trim($name)==='' || mb_strlen(trim($name))>$max) throw new RuntimeException('Revise el nombre del catálogo (máximo ' . $max . ' caracteres).',422);
            $name = trim($name);
            $order = filter_var($data['orden'],FILTER_VALIDATE_INT);
            if ($order === false || $order < -2147483648 || $order > 2147483647 || !in_array($data['activo'],[true,false,0,1,'0','1'],true)) throw new RuntimeException('Orden o estado inválido.',422);
            $values = [$name,$order,(int)(bool)$data['activo'],$this->id($user),$user['nombre'] ?? ''];
            if ($old) {
                $this->execute('UPDATE cliente_solicitud_catalogo SET nombre=?,orden=?,activo=?,actualizado_por=?,actualizado_por_nombre=?,actualizado_en=CURRENT_TIMESTAMP WHERE id=?',[...$values,$id]);
            } else {
                $ascii = strtr(mb_strtoupper($name),['Á'=>'A','É'=>'E','Í'=>'I','Ó'=>'O','Ú'=>'U','Ü'=>'U','Ñ'=>'N']);
                $base = substr(trim((string)preg_replace('/[^A-Z0-9]+/','_',$ascii),'_') ?: 'VALOR',0,54);
                // UNIQUE resuelve la concurrencia. Reintentar únicamente colisiones de código.
                for ($attempt=0; $attempt<20; $attempt++) {
                    $code = $base . ($attempt ? '_' . strtoupper(bin2hex(random_bytes(4))) : '');
                    try {
                        $this->execute('INSERT INTO cliente_solicitud_catalogo (nombre,orden,activo,actualizado_por,actualizado_por_nombre,tipo,codigo,creado_por,creado_por_nombre) VALUES (?,?,?,?,?,?,?,?,?)',[...$values,$tipo,$code,$this->id($user),$user['nombre'] ?? '']);
                        $id = (int)$this->db->mysql()->lastInsertId();
                        break;
                    } catch (PDOException $e) {
                        if (!in_array((string)$e->getCode(),['23000','23505'],true) || $attempt===19) throw $e;
                    }
                }
            }
            return ['ok'=>true,'catalogo'=>$this->rows('SELECT * FROM cliente_solicitud_catalogo WHERE id=?',[$id])[0]];
        });
    }

    public function route(array $user, string $method, string $path, array $query = [], array $body = []): array
    {
        if(preg_match('#^/(\d+)/prodin-rut$#',$path,$m)&&$method==='POST')return $this->consultarProdinRut($user,(int)$m[1],$body);
        if(preg_match('#^/(\d+)/historia-prodin(?:/(resumen|documentos|cotizaciones|notas-venta|facturas)(?:/(\d+))?)?$#',$path,$m)&&$method==='GET')return $this->historiaProdinSolicitud($user,(int)$m[1],$m[2]??'resumen',isset($m[3])?(int)$m[3]:null,$query);
        if($path==='/validar-rut'&&$method==='GET'){$this->access($user,'ventas');$this->procesarRechazos(false,self::normalizarRut((string)($query['rut']??'')));}
        if(preg_match('#^/(\d+)/(rechazar|apelar|aceptar-apelacion|confirmar-rechazo|reabrir)$#',$path,$m)&&$method==='POST')return $m[2]==='reabrir'?$this->reabrir($user,(int)$m[1],$body):$this->rechazo($user,(int)$m[1],$m[2],$body);
        if(str_starts_with($path,'/ciclos')||$path==='/validar-rut')return $this->ciclos->route($user,$method,$path,$query,$body);
        if(preg_match('#^/(\d+)/ciclo$#',$path,$cycleMatch)&&$method==='GET') {
            $row=$this->solicitud((int)$cycleMatch[1],$user,($query['ambito']??'')==='gestion');
            return ['ok'=>true,'ciclo'=>$row['ciclo']];
        }
        if (preg_match('#^/catalogos(?:/(\d+))?$#',$path,$m)) {
            $id = (int)($m[1] ?? 0);
            if ((!$id && in_array($method,['GET','POST'],true)) || ($id && in_array($method,['PATCH','DELETE'],true))) return $this->catalogos($user,$method,$query,$body,$id);
        }
        if ($path === '/fichas/buscar-rut' && $method === 'GET') return $this->buscarFichaRut($user,$query);
        if ($path === '/mis-solicitudes' && $method === 'GET') return $this->listRequests($user,$query,false);
        if ($path === '/gestion' && $method === 'GET') return $this->listRequests($user,$query,true);
        if ($path === '/contexto' && $method === 'GET') {
            $this->access($user,($query['ambito'] ?? '') === 'gestion' ? 'gestion' : 'ventas');
            $admin = true; try { $this->access($user,'admin'); } catch (RuntimeException) { $admin = false; }
            return ['ok'=>true,'usuario'=>$user,'fecha'=>date('d/m/Y'),'admin_responsables'=>$admin,'campos_ficha'=>self::FICHA,'campos_internos'=>self::INTERNOS,
                'vendedores'=>$this->rows('SELECT cod_vendedor,tipo FROM usuario_vendedor WHERE usuario_id=? ORDER BY CASE WHEN tipo=\'P\' THEN 0 ELSE 1 END,cod_vendedor',[$this->id($user)]),
                'filtro_vendedores'=>($query['ambito'] ?? '') === 'gestion' ? $this->rows("SELECT DISTINCT usuario_vendedor_id,vendedor_nombre FROM cliente_solicitud ORDER BY vendedor_nombre") : []];
        }
        if ($path === '/resumen' && $method === 'GET') {
            $global = ($query['ambito'] ?? '') === 'gestion';
            $this->access($user,$global ? 'gestion' : 'ventas');
            $params = $global ? [] : [$this->id($user)];
            $where = $global ? '1=1' : 'usuario_vendedor_id=?';
            if (!empty($query['tipo'])) { $where .= ' AND tipo=?'; $params[] = $this->tipo($query['tipo']); }
            return ['ok'=>true,'resumen'=>$this->rows('SELECT estado,COUNT(*) AS total FROM cliente_solicitud WHERE ' . $where . ' GROUP BY estado',$params)];
        }
        if ($path === '/prospectos' && $method === 'POST') return $this->save($user,$body,0,!empty($body['enviar']));
        if ($path === '/fichas' && $method === 'POST') return $this->save($user,$body,0,!empty($body['enviar']),'FICHA');
        $pathTipo = str_starts_with($path,'/fichas') ? 'FICHA' : 'PROSPECTO';
        $resourcePath = preg_replace('#^/fichas/#','/prospectos/',$path);
        if (preg_match('#^/prospectos/(\d+)(/enviar)?$#',$resourcePath,$m)) {
            if ($method === 'GET' && empty($m[2])) return ['ok'=>true,'solicitud'=>$this->solicitud((int)$m[1],$user,($query['ambito'] ?? '') === 'gestion')];
            if (($method === 'POST' && !empty($m[2])) || (in_array($method,['PUT','PATCH'],true) && empty($m[2]))) return $this->save($user,$body,(int)$m[1],!empty($m[2]),$pathTipo);
        }
        if (preg_match('#^/(\d+)/(revision|observar|completar)$#',$path,$m) && in_array($method,['POST','PATCH'],true)) return $this->process($user,(int)$m[1],$m[2],$body);
        if (preg_match('#^/(\d+)/historial$#',$path,$m) && $method === 'GET') {
            $this->solicitud((int)$m[1],$user,($query['ambito'] ?? '') === 'gestion');
            $history = $this->rows('SELECT * FROM cliente_solicitud_historial WHERE solicitud_id=? ORDER BY id',[(int)$m[1]]);
            if(($query['ambito']??'')!=='gestion')$history=array_values(array_filter($history,static fn($entry)=>!in_array($entry['accion'],['PRODIN_RUT_CONSULTADO','CODAUX_DISTINTO_PROPUESTO'],true)));
            if (($query['ambito'] ?? '') !== 'gestion') foreach ($history as &$entry) {
                $data = json_decode((string)$entry['datos_evento'],true) ?? [];
                unset($data['ficha_interna']);
                $entry['datos_evento'] = json_encode($data,JSON_UNESCAPED_UNICODE);
            }
            return ['ok'=>true,'historial'=>$history];
        }
        if (preg_match('#^/responsables(?:/(\d+))?$#',$path,$m)) {
            $id = (int)($m[1] ?? 0);
            if (($method === 'GET' && !$id) || ($method === 'POST' && !$id) || ($method === 'PATCH' && $id)) return $this->responsables($user,$method,$body,$id);
        }
        throw new RuntimeException('Ruta de Clientes y Prospectos no encontrada.',404);
    }
}
