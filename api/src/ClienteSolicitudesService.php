<?php
declare(strict_types=1);
require_once __DIR__ . '/GraphMailService.php';

final class ClienteSolicitudesService
{
    private const ESTADOS = ['BORRADOR','PENDIENTE','EN_REVISION','OBSERVADA','COMPLETADA','ANULADA'];
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

    public function __construct(private Database $db) {}

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
        if ($row['tipo'] === 'FICHA') {
            $row['ficha'] = $this->rows('SELECT * FROM cliente_solicitud_ficha WHERE solicitud_id=?',[$id])[0] ?? [];
            unset($row['ficha']['solicitud_id'],$row['ficha']['creado_en'],$row['ficha']['actualizado_en']);
            if (!$global) foreach (array_keys(self::INTERNOS) as $key) unset($row['ficha'][$key]);
        }
        return $row;
    }

    private function transaction(callable $operation): array
    {
        $pdo = $this->db->mysql();
        $pdo->beginTransaction();
        try {
            $result = $operation();
            $pdo->commit();
            return $result;
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($e instanceof PDOException && str_contains($e->getMessage(), 'uq_cliente_ficha_origen_activo')) throw new RuntimeException('Ya existe una Ficha de Cliente activa derivada de este Prospecto.',409);
            if ($e instanceof PDOException && str_contains($e->getMessage(), 'uq_cliente_solicitud_rut_activo')) {
                throw new RuntimeException('Ya existe otra solicitud activa del mismo tipo con este RUT.', 409);
            }
            throw $e;
        }
    }

    private function history(array $row, array $user, string $action, ?string $previous, string $comment = '', array $data = []): void
    {
        $this->execute('INSERT INTO cliente_solicitud_historial
            (solicitud_id,accion,estado_anterior,estado_nuevo,usuario_id,usuario_nombre,comentario,datos_evento)
            VALUES (?,?,?,?,?,?,?,?)', [$row['id'],$action,$previous,$row['estado'],$this->id($user),
                $user['nombre'] ?? '',$comment,json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);
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
            throw new RuntimeException('Ya existe otra solicitud activa de ' . $tipo . ' con este RUT.', 409);
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
            $data['estado'] = $send ? 'PENDIENTE' : 'BORRADOR';
            $data['actualizado_en'] = date('Y-m-d H:i:s');
            if (!$old) {
                $data['tipo'] = $tipo;
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
            $row = $this->solicitud($id,$user);
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
            $actionName = ['revision'=>'REVISION_INICIADA','observar'=>'OBSERVADA','completar'=>'COMPLETADA'][$action];
            $this->history($row,$user,$actionName,$old['estado'],$comment,$data + ['ficha_interna'=>$internal ?? null]);
            return $row;
        });
        return ['ok'=>true,'solicitud'=>$row,'correo'=>$action === 'revision' ? ['estado'=>'no_aplica'] : $this->notify($row,$action)];
    }

    public function destinatarios(string $tipo = 'PROSPECTO'): array
    {
        $column = $tipo === 'FICHA' ? 'recibe_ficha' : 'recibe_prospecto';
        return array_column($this->rows('SELECT email FROM cliente_solicitud_responsable WHERE activo=1 AND ' . $column . '=1 AND recibe_correo=1'),'email');
    }

    public function prepararCorreo(array $row, string $event): array
    {
        $logical = $event === 'enviar' ? $this->destinatarios($row['tipo']) : [$row['vendedor_email']];
        $test = strtolower((string)env('CLIENT_SOLICITUD_MAIL_TEST_MODE','false')) === 'true';
        $recipients = $logical;
        if ($test) {
            $target = strtolower(trim((string)env('CLIENT_SOLICITUD_MAIL_TEST_RECIPIENT')));
            if ($target === '') throw new RuntimeException('CLIENT_SOLICITUD_MAIL_TEST_RECIPIENT no configurado.',422);
            if ($target !== 'arivera@texpro.cl') throw new RuntimeException('Modo TEST permitido únicamente para arivera@texpro.cl.',422);
            $recipients = [$target];
        }
        $name = $row['tipo'] === 'FICHA' ? 'Ficha Cliente' : 'Prospecto';
        $title = ['enviar'=>'Nueva solicitud de ' . $name,'observar'=>'Solicitud de ' . $name . ' observada','completar'=>'Solicitud de ' . $name . ' completada'][$event];
        $subject = ($test ? '[LOCAL TEST] ' : '') . $title . ' ' . $row['correlativo'];
        $lines = [$subject,'Vendedor: ' . $row['vendedor_nombre'],'Código vendedor: ' . $row['codigo_vendedor'],'Cliente: ' . $row['razon_social'],'RUT: ' . $row['rut_original']];
        if ($test) $lines[] = 'Destinatario lógico original: ' . implode(', ',$logical);
        if ($event === 'completar') { $lines[] = 'Código auxiliar Softland: ' . $row['codigo_auxiliar_softland']; $lines[] = 'Ya puede continuar el proceso CRM en Softland.'; }
        if ($event === 'observar') $lines[] = 'Observación: ' . ($this->rows("SELECT comentario FROM cliente_solicitud_historial WHERE solicitud_id=? AND accion='OBSERVADA' ORDER BY id DESC LIMIT 1",[$row['id']])[0]['comentario'] ?? '');
        $path = $event === 'enviar' ? 'cobranza' : 'ventas';
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
        if (!empty($query['tipo'])) { $where[] = 'tipo=?'; $params[] = $this->tipo($query['tipo']); }
        if (!$global) { $where[] = 'usuario_vendedor_id=?'; $params[] = $this->id($user); }
        if ($global && !empty($query['vendedor'])) { $where[] = 'usuario_vendedor_id=?'; $params[] = (int)$query['vendedor']; }
        if (!empty($query['estado'])) {
            if (!in_array($query['estado'],self::ESTADOS,true)) throw new RuntimeException('Estado inválido.',422);
            $where[] = 'estado=?'; $params[] = $query['estado'];
        }
        $search = trim((string)($query['buscar'] ?? ''));
        if ($search !== '') {
            $where[] = '(razon_social LIKE ? OR rut_original LIKE ? OR rut_normalizado LIKE ?)';
            $params = [...$params,'%' . $search . '%','%' . $search . '%','%' . str_replace(['.','-'],'',strtoupper($search)) . '%'];
        }
        $condition = implode(' AND ',$where);
        $page = max(1,(int)($query['pagina'] ?? 1));
        $total = (int)$this->rows('SELECT COUNT(*) AS total FROM cliente_solicitud WHERE ' . $condition,$params)[0]['total'];
        return ['ok'=>true,'solicitudes'=>$this->rows('SELECT id,correlativo,tipo,estado,creado_en,usuario_vendedor_id,vendedor_nombre,codigo_vendedor,razon_social,rut_original,solicitud_origen_id,
            (SELECT origen.correlativo FROM cliente_solicitud origen WHERE origen.id=cliente_solicitud.solicitud_origen_id) AS origen_correlativo
            FROM cliente_solicitud WHERE ' . $condition . ' ORDER BY creado_en DESC,id DESC LIMIT 50 OFFSET ' . (($page-1)*50),$params),'total'=>$total,'pagina'=>$page];
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
            if (!is_string($tipo) || !isset(self::CATALOGOS[$tipo])) throw new RuntimeException('Tipo de catálogo inválido.',422);
            return ['ok'=>true,'catalogos'=>$this->rows('SELECT *,CASE WHEN usado_en IS NULL THEN 1 ELSE 0 END AS puede_eliminar FROM cliente_solicitud_catalogo WHERE tipo=?' . (!empty($query['todos']) ? '' : ' AND activo=1') . ' ORDER BY orden,nombre',[$tipo])];
        }
        $this->access($user,'admin');
        return $this->transaction(function () use ($user,$method,$body,$id) {
            $lock = $this->db->mysql()->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? ' FOR UPDATE' : '';
            $old = $id ? ($this->rows('SELECT * FROM cliente_solicitud_catalogo WHERE id=?' . $lock,[$id])[0] ?? null) : null;
            if ($id && !$old) throw new RuntimeException('Valor de catálogo no encontrado.',404);
            if ($method === 'DELETE') {
                [$field,$codeField] = self::CATALOGOS[$old['tipo']];
                $used = $old['usado_en'] || $this->rows("SELECT solicitud_id FROM cliente_solicitud_ficha WHERE $codeField=? OR ($codeField IS NULL AND ($field=? OR $field=?)) LIMIT 1",[$old['codigo'],$old['codigo'],$old['nombre']]);
                if ($used) throw new RuntimeException('Este valor ya fue utilizado en solicitudes y no puede eliminarse. Puedes desactivarlo.',409);
                $this->execute('DELETE FROM cliente_solicitud_catalogo WHERE id=?',[$id]);
                return ['ok'=>true];
            }
            $tipo = $old['tipo'] ?? ($body['tipo'] ?? '');
            if (!is_string($tipo) || !isset(self::CATALOGOS[$tipo])) throw new RuntimeException('Tipo de catálogo inválido.',422);
            if (isset($body['codigo']) || (isset($body['tipo']) && $body['tipo'] !== $tipo)) throw new RuntimeException('El código y el tipo no pueden modificarse.',422);
            $data = array_replace($old ?? ['orden'=>0,'activo'=>1],$body);
            $name = $data['nombre'] ?? '';
            [$field] = self::CATALOGOS[$tipo];
            if (!is_string($name) || trim($name)==='' || mb_strlen(trim($name))>self::FICHA[$field][1]) throw new RuntimeException('Revise el nombre del catálogo (máximo ' . self::FICHA[$field][1] . ' caracteres).',422);
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
