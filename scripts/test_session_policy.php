<?php
declare(strict_types=1);

// Autenticación aislada: fakes de MySQL, sin conexiones ni escrituras reales.
$sessionEnvironment = ['JWT_SECRET' => 'clave-exclusiva-para-pruebas-locales', 'APP_ENV' => 'production'];
function env(string $key, mixed $default = null): mixed { global $sessionEnvironment; return $sessionEnvironment[$key] ?? $default; }
require_once dirname(__DIR__) . '/api/src/Security.php';
require_once dirname(__DIR__) . '/api/src/Services.php';

final class Database
{
    public array $profiles = [], $writes = [];
    public int $reads = 0;
    public ?array $user;
    public function __construct()
    {
        $this->user = ['id' => 7, 'email' => 'test@example.invalid', 'nombre' => 'Prueba', 'area' => 'GERENCIA',
            'is_admin' => 1, 'is_active' => 1, 'password' => Security::hash_password_django('local-test')];
    }
    public function fetchOne(string $sql, array $params = []): ?array { $this->reads++; return str_contains($sql, 'FROM usuario u') ? $this->user : null; }
    public function fetchAll(string $sql, array $params = []): array
    {
        $this->reads++;
        return str_contains($sql, 'p.id, p.codigo, p.nombre, p.descripcion, p.activo') ? $this->profiles : [];
    }
    public function execute(string $sql, array $params = []): int { $this->writes[] = $sql; return 1; }
}

$checks = 0;
function check(bool $ok, string $label): void { global $checks; if (!$ok) throw new RuntimeException('FALLO: ' . $label); $checks++; }
function rejects(callable $call): void
{
    try { $call(); } catch (RuntimeException $error) { check($error->getCode() === 401, 'rechazo 401'); return; }
    throw new RuntimeException('Se esperaba rechazo de autenticación.');
}
function claims(string $token): array { return Security::jwt_decode($token, env('JWT_SECRET')); }

foreach ([
    [[], 'general', 9 * 3600],
    [[['codigo' => 'ventas', 'nombre' => 'Ventas', 'activo' => true]], 'general', 9 * 3600],
    [[['codigo' => ' GERENCIA ', 'activo' => true]], 'gerencia', 30 * 86400],
    [[['codigo' => 'Geréncia', 'activo' => true]], 'gerencia', 30 * 86400],
    [[['nombre' => 'Gerencia', 'activo' => true]], 'gerencia', 30 * 86400],
    [[['codigo' => 'ventas', 'nombre' => 'Gerencia', 'activo' => true]], 'general', 9 * 3600],
    [[['codigo' => 'gerencia', 'activo' => false]], 'general', 9 * 3600],
] as [$profiles, $name, $duration]) {
    $token = Security::jwt_encode_session(['sub' => 7, 'perfiles' => $profiles], env('JWT_SECRET'));
    $data = claims($token);
    check($data['session_policy'] === $name, 'política por perfiles activos: ' . $name);
    check($data['session_warning_at'] - $data['iat'] === $duration, 'duración absoluta');
    check($data['exp'] - $data['session_warning_at'] === 60 && $data['session_warning_seconds'] === 60, 'ventana de 60 segundos');
}
$db = new Database(); $auth = new AuthService($db);
$login = $auth->login('prueba', 'local-test');
check(claims($login['token'])['session_policy'] === 'general', 'área/admin no eligen política');
$db->profiles = [['id' => 1, 'codigo' => 'gerencia', 'nombre' => 'Gerencia', 'activo' => 1]];
$management = $auth->refresh($login['token']);
check(claims($management['token'])['session_warning_at'] - claims($management['token'])['iat'] === 30 * 86400, 'refresh vuelve a cargar perfiles');
check($management['token'] !== $login['token'] && $auth->refresh($management['token'])['token'] !== $management['token'], 'JWT nuevo incluso dentro del mismo segundo');
$db->profiles = [];
$normal = $auth->refresh($management['token']);
check(claims($normal['token'])['session_policy'] === 'general' && claims($normal['token'])['exp'] - claims($normal['token'])['iat'] === 9 * 3600 + 60, 'retirar Gerencia aplica 9h en la renovación');
$warning = Security::jwt_encode(['sub' => 7], env('JWT_SECRET'), 60, time() - 30);
check($auth->refresh($warning)['ok'], 'renovación durante ventana válida');
$expired = Security::jwt_encode(['sub' => 7], env('JWT_SECRET'), 60, time() - 61);
$before = $db->reads; rejects(fn() => $auth->refresh($expired));
check($db->reads === $before, 'expirado se rechaza antes de consultar MySQL');
$boundary = Security::jwt_encode(['sub' => 7], env('JWT_SECRET'), 60, time() - 60);
rejects(fn() => $auth->refresh($boundary));
$parts = explode('.', $normal['token']); $parts[2][0] = $parts[2][0] === 'A' ? 'B' : 'A';
rejects(fn() => $auth->refresh(implode('.', $parts)));
$db->user['is_active'] = 0; rejects(fn() => $auth->refresh($normal['token']));
$db->user = null; rejects(fn() => $auth->refresh($normal['token']));
$sessionEnvironment['SESSION_TEST_ACTIVE_SECONDS'] = '5';
check(Security::sessionPolicyForProfiles([])['activeSeconds'] === 9 * 3600, 'producción ignora tiempos de prueba');
$sessionEnvironment['APP_ENV'] = 'local';
check(Security::sessionPolicyForProfiles([])['activeSeconds'] === 5 && Security::sessionPolicyForProfiles([])['warningSeconds'] === 60, 'tiempo reducido solo mediante configuración local explícita');
unset($sessionEnvironment['SESSION_TEST_ACTIVE_SECONDS']);
check(Security::sessionPolicyForProfiles([])['activeSeconds'] === 9 * 3600, 'local sin override conserva defaults');

// Prueba de rutas sin emitir cookies reales: captura los efectos del adaptador HTTP.
function require_bearer_token(): string { global $routeToken; if (!$routeToken) throw new RuntimeException('Token requerido', 401); return $routeToken; }
function clear_auth_cookie(): void { global $clears; $clears++; }
function set_auth_cookie(string $token): void { global $cookieToken; $cookieToken = $token; }
class SessionRouteResponse extends RuntimeException { public function __construct(public array $response) { parent::__construct(); } }
function json_response(array $response): never { throw new SessionRouteResponse($response); }
$route = require dirname(__DIR__) . '/api/routes/auth.php';
$db = new Database(); $services = ['auth' => new AuthService($db), 'recovery' => new RecoveryService($db)];
$clears = 0; $routeToken = '';
foreach (['', $expired, 'token-invalido'] as $routeToken) {
    try { $route('POST', '/logout', [], [], $services); } catch (SessionRouteResponse $result) { check($result->response['ok'], 'logout sin token válido'); }
}
check($clears === 3, 'logout idempotente limpia cookie siempre');
$routeToken = $normal['token']; $cookieToken = '';
try { $route('POST', '/refresh', [], [], $services); } catch (SessionRouteResponse $result) {
    check($cookieToken === $result->response['token'] && $cookieToken !== $routeToken, 'refresh sincroniza JWT y cookie');
}
echo "OK: $checks comprobaciones de sesión/autenticación con fakes, sin conexiones ni escrituras reales.\n";
