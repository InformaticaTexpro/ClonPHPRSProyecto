<?php
declare(strict_types=1);

// Dos bases SQLite en memoria simulan MySQL y Softland. Nunca carga .env ni bootstrap.
require_once dirname(__DIR__) . '/api/src/SharedServiceHelpers.php';
require_once dirname(__DIR__) . '/api/src/Security.php';
require_once dirname(__DIR__) . '/api/src/AnalyticsService.php';
require_once dirname(__DIR__) . '/api/src/ClienteClasificacionOverrideService.php';
require_once dirname(__DIR__) . '/api/src/CobranzaOverridesService.php';

final class OverrideSoftlandPDO extends PDO
{
    public int $queries = 0;
    public function __construct() { parent::__construct('sqlite::memory:'); $this->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION); }
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $this->queries++;
        $query = str_replace('[PRODIN].[softland].', '', $query);
        $query = preg_replace('/CONVERT\(varchar\(10\), h.Fecha, 23\)/', 'DATE(h.Fecha)', $query);
        $query = preg_replace('/CONVERT\(varchar\(80\), c.RutAux\)/', 'CAST(c.RutAux AS TEXT)', $query);
        return parent::prepare($query, $options);
    }
}
final class Database
{
    public function __construct(private PDO $mysql, private PDO $softland) {}
    public function mysql(): PDO { return $this->mysql; }
    public function softland(): PDO { return $this->softland; }
    public function fetchOne(string $sql, array $params = []): ?array { $stmt = $this->mysql->prepare($sql); $stmt->execute($params); return $stmt->fetch(PDO::FETCH_ASSOC) ?: null; }
    public function fetchAll(string $sql, array $params = []): array { $stmt = $this->mysql->prepare($sql); $stmt->execute($params); return $stmt->fetchAll(PDO::FETCH_ASSOC); }
}
$mysql = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$softland = new OverrideSoftlandPDO();
$mysql->exec("CREATE TABLE usuario (id INTEGER, nombre TEXT, is_admin INTEGER, is_active INTEGER);
    INSERT INTO usuario VALUES (1,'ADMIN LOCAL',1,1),(2,'VENDEDOR',0,1),(3,'ADMIN MENU',0,1),(4,'INACTIVO',1,0);
    CREATE TABLE usuario_vendedor (usuario_id INTEGER, cod_vendedor TEXT);
    INSERT INTO usuario_vendedor VALUES (2,'246'),(3,'652');
    CREATE TABLE factura_compartida (folio INTEGER, porcentaje REAL, cod_vendedor_principal TEXT, cod_vendedor_compartido TEXT, rol TEXT, fecha TEXT);
    CREATE TABLE cliente_clasificacion_override (
        id INTEGER PRIMARY KEY AUTOINCREMENT, periodo TEXT, tipo_evento TEXT, accion TEXT, rut_normalizado TEXT,
        rut_original TEXT, codaux TEXT, tipo_documento TEXT, folio TEXT, nroint TEXT, fecha_documento TEXT,
        cliente_nombre TEXT, codigo_vendedor_origen TEXT, motivo_codigo TEXT, motivo_detalle TEXT, datos_validacion TEXT,
        creado_por INTEGER, creado_por_nombre TEXT, creado_en TEXT DEFAULT CURRENT_TIMESTAMP, activo INTEGER DEFAULT 1,
        revertido_por INTEGER, revertido_por_nombre TEXT, revertido_en TEXT, motivo_reversion TEXT)");
$softland->exec("CREATE TABLE iw_gsaen (Tipo TEXT, Folio INTEGER, NroInt INTEGER, Fecha TEXT, CodAux TEXT, CodVendedor TEXT, Estado TEXT, NomAux TEXT);
    CREATE TABLE cwtauxi (CodAux TEXT, RutAux TEXT, NomAux TEXT);
    CREATE TABLE iw_gmovi (NroInt INTEGER, Tipo TEXT, TotLinea REAL, CodProd TEXT);
    CREATE TABLE iw_tprod (CodProd TEXT);
    INSERT INTO cwtauxi VALUES ('84807201','84.807.200-1','BRUNO FRITSCH SA');
    INSERT INTO iw_gsaen VALUES ('F',380985,123,'2026-10-05','84807201','246','V','BRUNO'),
        ('F',380986,124,'2026-10-05','84807201','246','A','BRUNO'),
        ('N',380987,125,'2026-10-05','84807201','246','V','BRUNO');
    INSERT INTO iw_tprod VALUES ('P');
    INSERT INTO iw_gmovi VALUES (123,'F',324017,'P')");
$db = new Database($mysql, $softland);
$central = new ClienteClasificacionOverrideService($db);
$api = new CobranzaOverridesService($db, new AnalyticsService($db), $central);
$base = '/control-clientes/overrides';
$admin = ['sub' => 1];
$seller = ['sub' => 2, 'menus' => [['codigo' => 'cobranza_control_clientes']]];
$input = ['periodo' => '2026-10', 'tipoEvento' => 'RECUPERADO', 'rut' => '84.807.200-1', 'codaux' => '84807201', 'folio' => '380985'];
$create = $input + ['accion' => 'EXCLUIR', 'motivoCodigo' => 'CORRECCION_ADMINISTRATIVA'];
$checks = 0;
$expect = static function (mixed $actual, mixed $expected, string $name) use (&$checks): void {
    $checks++;
    if ($actual !== $expected) throw new RuntimeException($name . ': ' . json_encode([$actual, $expected]));
};
$error = static function (callable $operation, int $code) use ($expect): void {
    try { $operation(); } catch (RuntimeException $e) { $expect($e->getCode(), $code, 'Error esperado'); return; }
    throw new LogicException('Error no producido: ' . $code);
};
foreach ([['sub' => 2], $seller, ['sub' => 4], ['sub' => 999]] as $payload) {
    foreach (['', '/validar', '/revertir'] as $suffix) $error(fn() => $api->route($payload, 'POST', $base . $suffix, [], $create), 403);
    $error(fn() => $api->route($payload, 'GET', $base), 403);
}
$expect($softland->queries, 0, 'Permisos se verifican antes de Softland');
$expect($api->route($seller, 'GET', $base . '/permisos')['puedeAdministrar'], false, 'Vendedor sin acciones UI');
$manager = ['sub' => 3, 'menus' => [['codigo' => 'cobranza_control_clientes'], ['codigo' => 'administracion']]];
$expect($api->route($manager, 'GET', $base . '/permisos')['puedeAdministrar'], true, 'Administración heredada');
$valid = $api->route($admin, 'POST', $base . '/validar', [], $input);
$expect($valid['validado'], true, 'Documento correcto');
$expect($valid['documento']['fecha'], '2026-10-05', 'Fecha real');
$expect($valid['documento']['monto'], 324017.0, 'Monto real');
$expect($valid['cliente']['nombre'], 'BRUNO FRITSCH SA', 'Cliente real');
$expect($valid['vendedor']['nombre'], 'VENDEDOR', 'Vendedor desde relaciones');
$expect($valid['compartidos'], [], 'Sin compartidos');
foreach ([['folio' => '999999', 'message' => 'El folio no existe.'], ['folio' => '380986', 'message' => 'El documento está anulado.'],
    ['folio' => '380987', 'message' => 'El documento no es una factura Tipo F.'],
    ['codaux' => 'OTRO', 'message' => 'El folio no pertenece al CodAux indicado.'],
    ['rut' => '111111111', 'message' => 'El RUT ingresado no corresponde al cliente del documento.'],
    ['periodo' => '2026-11', 'message' => 'El documento no corresponde al período 2026-11.']] as $case) {
    $message = $case['message']; unset($case['message']);
    $result = $api->route($admin, 'POST', $base . '/validar', [], array_replace($input, $case));
    $expect($result['validado'], false, 'Inconsistencia rechazada');
    $expect($result['mensaje'], $message, 'Mensaje preciso');
}
foreach ([['periodo' => '2026-13'], ['tipoEvento' => 'OTRO'], ['rut' => ''], ['codaux' => ''], ['folio' => '-1']] as $case) {
    $error(fn() => $api->route($admin, 'POST', $base . '/validar', [], array_replace($input, $case)), 400);
}
$error(fn() => $api->route($admin, 'POST', $base, [], array_replace($create, ['motivoCodigo' => 'OTRO', 'motivoDetalle' => ' '])), 400);
$error(fn() => $api->route($admin, 'POST', $base, [], array_replace($create, ['motivoCodigo' => 'NO_ADMITIDO'])), 400);
// La validación anterior no habilita guardar si Softland cambia entre ambas llamadas.
$softland->exec("UPDATE iw_gsaen SET Estado = 'A' WHERE NroInt = 123");
$error(fn() => $api->route($admin, 'POST', $base, [], $create), 400);
$expect(count($central->listar()), 0, 'Sin insert ante documento alterado');
$softland->exec("UPDATE iw_gsaen SET Estado = 'V' WHERE NroInt = 123");
$mysql->exec("INSERT INTO factura_compartida VALUES (380985,50,'0246','652','compartido','2026-10-01'),
    (380985,50,'999','652','compartido','2026-10-01'),(380985,50,'246','652','compartido','2026-09-01')");
$beforeQueries = $softland->queries;
$saved = $api->route($admin, 'POST', $base, [], $create + ['clienteNombre'=>'FALSO','codigoVendedorOrigen'=>'999','datosValidacion'=>['password'=>'no guardar'],'creado_por'=>999])['item'];
$expect($softland->queries > $beforeQueries, true, 'Guardar vuelve a consultar Softland');
$expect($saved['activo'], true, 'Override activo');
$expect($saved['creadoPor'], 'ADMIN LOCAL', 'Auditoría autenticada');
$row = $central->buscarVigente('2026-10', 'RECUPERADO', '848072001');
$evidence = json_decode($row['datos_validacion'], true, 512, JSON_THROW_ON_ERROR);
$expect($row['cliente_nombre'], 'BRUNO FRITSCH SA', 'No confía en nombre HTTP');
$expect($row['codigo_vendedor_origen'], '246', 'No confía en vendedor HTTP');
$expect($row['nroint'], '123', 'NroInt real');
$expect($evidence['monto'], 324017, 'Evidencia real');
$expect(count($evidence['compartidos']), 1, 'Compartidos por mes, folio y origen');
$expect($evidence['compartidos'][0]['porcentaje'], 50, 'Porcentaje auditado');
$expect(isset($evidence['password']), false, 'Descarta evidencia arbitraria');
$expect(isset($saved['datos_validacion']), false, 'Listado no expone evidencia innecesaria');
$error(fn() => $api->route($admin, 'POST', $base, [], $create), 409);
$expect(count($api->route($admin, 'GET', $base, ['activo' => '1', 'rut' => '848072001'])['items']), 1, 'Listado activos');
$error(fn() => $api->route($admin, 'POST', $base . '/revertir', [], ['id'=>$saved['id'],'motivo'=>' ']), 400);
$reverted = $api->route($admin, 'POST', $base . '/revertir', [], ['id'=>$saved['id'],'motivo'=>'Finalizar prueba aislada'])['item'];
$expect($reverted['activo'], false, 'Revertido');
$expect($reverted['revertidoPor'], 'ADMIN LOCAL', 'Actor reversión');
$expect(is_string($reverted['revertidoEn']), true, 'Fecha reversión');
$expect(count($api->route($admin, 'GET', $base, ['activo' => '0'])['items']), 1, 'Historial revertidos');
$include = array_replace($create, ['accion'=>'INCLUIR','motivoCodigo'=>'OTRO','motivoDetalle'=>'Prueba de inclusión']);
$api->route($admin, 'POST', $base, [], $include);
$error(fn() => $api->route($admin, 'POST', $base, [], array_replace($include, ['tipoEvento'=>'NUEVO'])), 409);

// La ruta HTTP existente despacha al administrador; no pasa por report().
final class OverrideJsonResponse extends RuntimeException { public function __construct(public array $body) { parent::__construct(); } }
function require_current_user(): array { return ['sub'=>1]; }
function json_response(array $body): never { throw new OverrideJsonResponse($body); }
$handler = require dirname(__DIR__) . '/api/routes/cobranza.php';
try { $handler('GET', $base, ['activo'=>'1'], [], ['cobranza_overrides'=>$api]); }
catch (OverrideJsonResponse $response) { $expect(count($response->body['items']), 1, 'Dispatch ruta de listado'); }
echo "OK cobranza overrides: $checks validaciones; MySQL y Softland simulados en SQLite, sin conexiones reales.\n";
