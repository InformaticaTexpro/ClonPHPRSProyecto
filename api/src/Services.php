<?php
declare(strict_types=1);

final class AuthService
{
    public function __construct(private Database $db)
    {
    }

    public function login(string $login, string $password): array
    {
        $loginFinal = Security::normalize_login($login);
        if ($loginFinal === '' || $password === '') {
            throw new RuntimeException('Email y contraseña requeridos', 400);
        }

        $user = $this->db->fetchOne(
            "SELECT u.id, u.email, u.nombre, u.password, u.area, u.is_admin, u.is_active
             FROM usuario u
             WHERE LOWER(TRIM(COALESCE(u.email, ''))) = ?
                OR LOWER(TRIM(COALESCE(u.nombre, ''))) = ?
                OR LOWER(TRIM(COALESCE(u.codigo, ''))) = ?
             LIMIT 1",
            [$loginFinal, $loginFinal, $loginFinal]
        );

        if (!$user || !(int)$user['is_active']) {
            throw new RuntimeException('Usuario o contraseña incorrectos', 401);
        }

        if (!Security::verify_password_django($password, (string)$user['password'])) {
            throw new RuntimeException('Usuario o contraseña incorrectos', 401);
        }

        $this->db->execute('UPDATE usuario SET last_login = NOW() WHERE id = ?', [$user['id']]);
        $vendedores = $this->load_vendedores((int)$user['id']);
        $menusData = $this->load_user_menus((int)$user['id']);
        $payload = $this->build_payload($user, $vendedores, $menusData['perfiles'], $menusData['menus']);
        $token = Security::jwt_encode($payload, (string)env('JWT_SECRET', ''), env('JWT_EXPIRES_IN', '8h'));

        return [
            'ok' => true,
            'token' => $token,
            'user' => $payload,
            'allMenus' => $menusData['allMenus'],
        ];
    }

    public function me(string $token): array
    {
        $payload = Security::jwt_decode($token, (string)env('JWT_SECRET', ''));
        $userId = (int)($payload['sub'] ?? $payload['id'] ?? 0);
        if ($userId <= 0) {
            throw new RuntimeException('Token inválido.', 401);
        }

        $user = $this->db->fetchOne(
            'SELECT u.id, u.email, u.nombre, u.area, u.is_admin, u.is_active
             FROM usuario u WHERE u.id = ? LIMIT 1',
            [$userId]
        );
        if (!$user || !(int)$user['is_active']) {
            throw new RuntimeException('Sesión no válida', 401);
        }

        $vendedores = $this->load_vendedores($userId);
        $menusData = $this->load_user_menus($userId);

        return [
            'ok' => true,
            'user' => array_merge($user, [
                'vendedores' => $vendedores,
                'perfiles' => $menusData['perfiles'],
                'menus' => $menusData['menus'],
            ]),
            'allMenus' => $menusData['allMenus'],
        ];
    }

    public function refresh(string $token): array
    {
        $decoded = Security::jwt_decode($token, (string)env('JWT_SECRET', ''), true);
        $now = time();
        $exp = (int)($decoded['exp'] ?? 0);
        $window = 24 * 3600;
        if ($exp > 0 && ($now - $exp) > $window) {
            throw new RuntimeException('Token demasiado antiguo para renovar. Inicia sesión nuevamente.', 401);
        }

        $userId = (int)($decoded['sub'] ?? $decoded['id'] ?? 0);
        if ($userId <= 0) {
            throw new RuntimeException('Token inválido.', 401);
        }

        $user = $this->db->fetchOne(
            'SELECT u.id, u.email, u.nombre, u.area, u.is_admin, u.is_active
             FROM usuario u WHERE u.id = ? LIMIT 1',
            [$userId]
        );
        if (!$user || !(int)$user['is_active']) {
            throw new RuntimeException('Usuario inactivo o no encontrado', 401);
        }

        $vendedores = $this->load_vendedores($userId);
        $menusData = $this->load_user_menus($userId);
        $payload = $this->build_payload($user, $vendedores, $menusData['perfiles'], $menusData['menus']);

        return [
            'ok' => true,
            'token' => Security::jwt_encode($payload, (string)env('JWT_SECRET', ''), env('JWT_EXPIRES_IN', '8h')),
            'allMenus' => $menusData['allMenus'],
        ];
    }

    private function load_vendedores(int $userId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT cod_vendedor, tipo FROM usuario_vendedor WHERE usuario_id = ?',
            [$userId]
        );

        return array_values(array_map(static function (array $row): array {
            return [
                'cod_vendedor' => trim((string)($row['cod_vendedor'] ?? '')),
                'tipo' => strtoupper(trim((string)($row['tipo'] ?? ''))),
            ];
        }, $rows));
    }

    private function load_user_menus(int $userId): array
    {
        $menus = $this->db->fetchAll(
            'SELECT DISTINCT
                m.id, m.codigo, m.nombre, m.url, m.icono, m.grupo, m.orden
             FROM menu m
             INNER JOIN (
               SELECT um.menu_id
               FROM usuario_menu um
               WHERE um.usuario_id = ? AND um.activo = 1
               UNION
               SELECT pm.menu_id
               FROM usuario_perfil up
               INNER JOIN perfil p ON p.id = up.perfil_id
               INNER JOIN perfil_menu pm ON pm.perfil_id = p.id
               WHERE up.usuario_id = ?
                 AND up.activo = 1
                 AND p.activo = 1
                 AND pm.activo = 1
             ) accesos ON accesos.menu_id = m.id
             WHERE m.activo = 1
             ORDER BY m.orden ASC, m.grupo ASC, m.nombre ASC',
            [$userId, $userId]
        );

        $perfiles = $this->db->fetchAll(
            'SELECT DISTINCT
                p.id, p.codigo, p.nombre, p.descripcion, p.activo
             FROM usuario_perfil up
             INNER JOIN perfil p ON p.id = up.perfil_id
             WHERE up.usuario_id = ?
               AND up.activo = 1
               AND p.activo = 1
             ORDER BY p.nombre ASC',
            [$userId]
        );

        $allMenus = $this->db->fetchAll(
            'SELECT
                m.id, m.codigo, m.nombre, m.url, m.icono, m.grupo, m.orden
             FROM menu m
             WHERE m.activo = 1
             ORDER BY m.orden ASC, m.grupo ASC, m.nombre ASC'
        );

        $menus = array_values(array_filter(array_map([self::class, 'normalize_menu'], $menus), static fn ($menu) => $menu['id'] !== null && $menu['url'] !== ''));
        $allMenus = array_values(array_filter(array_map([self::class, 'normalize_menu'], $allMenus), static fn ($menu) => $menu['id'] !== null && $menu['url'] !== ''));
        $perfiles = array_values(array_filter(array_map(static function (array $perfil): array {
            return [
                'id' => isset($perfil['id']) ? (int)$perfil['id'] : null,
                'codigo' => trim((string)($perfil['codigo'] ?? '')),
                'nombre' => trim((string)($perfil['nombre'] ?? '')),
                'descripcion' => trim((string)($perfil['descripcion'] ?? '')),
                'activo' => (bool)($perfil['activo'] ?? false),
            ];
        }, $perfiles), static fn ($perfil) => $perfil['id'] !== null));

        return compact('menus', 'perfiles', 'allMenus');
    }

    private static function normalize_menu(array $menu): array
    {
        $codigo = trim((string)($menu['codigo'] ?? ''));
        $grupo = trim((string)($menu['grupo'] ?? 'General'));
        if ($codigo === 'rrhh' || $codigo === 'rrhh_reportes_compartidos') {
            $grupo = 'RRHH';
        }

        return [
            'id' => isset($menu['id']) ? (int)$menu['id'] : null,
            'codigo' => $codigo,
            'nombre' => trim((string)($menu['nombre'] ?? '')),
            'url' => trim((string)($menu['url'] ?? '')),
            'icono' => trim((string)($menu['icono'] ?? '')),
            'grupo' => $grupo !== '' ? $grupo : 'General',
            'orden' => (int)($menu['orden'] ?? 0),
        ];
    }

    private function build_payload(array $user, array $vendedores, array $perfiles, array $menus): array
    {
        return [
            'id' => (int)$user['id'],
            'sub' => (int)$user['id'],
            'email' => (string)$user['email'],
            'nombre' => (string)$user['nombre'],
            'area' => (string)$user['area'],
            'is_admin' => (bool)$user['is_admin'],
            'vendedores' => $vendedores,
            'perfiles' => $perfiles,
            'menus' => $menus,
        ];
    }
}

final class RecoveryService
{
    private const TTL_MINUTES = 15;

    public function __construct(private Database $db)
    {
    }

    public function request_reset(string $email): array
    {
        $email = Security::validate_email($email);
        $user = $this->db->fetchOne('SELECT * FROM usuario WHERE email = ? LIMIT 1', [$email]);

        if ($user && (int)$user['is_active'] === 1) {
            $code = $this->create_otp($email);
            $this->send_otp($email, $code);
        }

        return [
            'ok' => true,
            'message' => 'Si el correo está registrado, recibirás el código en breve.',
        ];
    }

    public function verify_otp(string $email, string $otp): array
    {
        $email = Security::validate_email($email);
        if (!preg_match('/^\d{6}$/', trim($otp))) {
            throw new RuntimeException('Email y código de 6 dígitos son requeridos.', 400);
        }

        $row = $this->db->fetchOne(
            'SELECT id FROM otp_tokens
             WHERE email = ?
               AND codigo = ?
               AND usado = 0
               AND expira_en > NOW(6)
             ORDER BY creado_en DESC
             LIMIT 1',
            [$email, trim($otp)]
        );

        if (!$row) {
            throw new RuntimeException('Código incorrecto o expirado.', 401);
        }

        $this->db->execute('UPDATE otp_tokens SET usado = 1 WHERE id = ?', [$row['id']]);
        $token = Security::jwt_encode(['email' => $email, 'purpose' => 'password_reset'], (string)env('JWT_SECRET', ''), '15m');

        return [
            'ok' => true,
            'message' => 'Código verificado correctamente.',
            'resetToken' => $token,
        ];
    }

    public function set_new_password(string $resetToken, string $password): array
    {
        $resetToken = trim($resetToken);
        if ($resetToken === '' || $password === '') {
            throw new RuntimeException('Token y contraseña son requeridos.', 400);
        }
        if (mb_strlen($password) < 8) {
            throw new RuntimeException('La contraseña debe tener mínimo 8 caracteres.', 400);
        }

        $payload = Security::jwt_decode($resetToken, (string)env('JWT_SECRET', ''));
        if (($payload['purpose'] ?? '') !== 'password_reset') {
            throw new RuntimeException('Token de restablecimiento inválido o expirado.', 401);
        }

        $email = Security::validate_email((string)($payload['email'] ?? ''));
        $hash = Security::hash_password_django($password);
        $updated = $this->db->execute(
            'UPDATE usuario SET password = ? WHERE email = ? AND is_active = 1',
            [$hash, $email]
        );

        if ($updated <= 0) {
            throw new RuntimeException('Usuario no encontrado o inactivo.', 404);
        }

        return [
            'ok' => true,
            'message' => 'Contraseña actualizada correctamente. Ya puedes iniciar sesión.',
        ];
    }

    private function create_otp(string $email): string
    {
        $code = str_pad((string)random_int(100000, 999999), 6, '0', STR_PAD_LEFT);
        $this->db->execute('UPDATE otp_tokens SET usado = 1 WHERE email = ? AND usado = 0', [$email]);
        $this->db->execute(
            'INSERT INTO otp_tokens (email, codigo, expira_en) VALUES (?, ?, DATE_ADD(NOW(6), INTERVAL ? MINUTE))',
            [$email, $code, self::TTL_MINUTES]
        );
        return $code;
    }

    private function send_otp(string $email, string $code): void
    {
        $tenantId = (string)env('MAIL_TENANT_ID', '');
        $clientId = (string)env('MAIL_CLIENT_ID', '');
        $clientSecret = (string)env('MAIL_CLIENT_SECRET', '');
        $fromAddress = (string)env('MAIL_FROM_ADDRESS', '');
        $fromName = (string)env('MAIL_FROM_NAME', 'TEXPRO');

        if ($tenantId === '' || $clientId === '' || $clientSecret === '' || $fromAddress === '') {
            throw new RuntimeException('Faltan variables de correo Microsoft Graph en .env', 500);
        }

        $token = $this->fetch_graph_access_token($tenantId, $clientId, $clientSecret);
        $html = $this->build_otp_html($code);
        $payload = json_encode([
            'message' => [
                'subject' => $code . ' - Tu código de recuperación TEXPRO',
                'body' => ['contentType' => 'HTML', 'content' => $html],
                'toRecipients' => [['emailAddress' => ['address' => $email]]],
            ],
            'saveToSentItems' => false,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => 'https://graph.microsoft.com/v1.0/users/' . rawurlencode($fromAddress) . '/sendMail',
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $token,
                'Content-Type: application/json',
                'Content-Length: ' . strlen((string)$payload),
            ],
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_TIMEOUT => 30,
        ]);

        $response = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if ($response === false || $status !== 202) {
            $error = curl_error($ch);
            curl_close($ch);
            throw new RuntimeException('Graph API error al enviar el OTP: ' . ($error !== '' ? $error : (string)$response), 500);
        }

        curl_close($ch);
    }

    private function fetch_graph_access_token(string $tenantId, string $clientId, string $clientSecret): string
    {
        $post = http_build_query([
            'grant_type' => 'client_credentials',
            'client_id' => $clientId,
            'client_secret' => $clientSecret,
            'scope' => 'https://graph.microsoft.com/.default',
        ]);

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => 'https://login.microsoftonline.com/' . rawurlencode($tenantId) . '/oauth2/v2.0/token',
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/x-www-form-urlencoded',
                'Content-Length: ' . strlen($post),
            ],
            CURLOPT_POSTFIELDS => $post,
            CURLOPT_TIMEOUT => 30,
        ]);

        $response = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if ($response === false || $status < 200 || $status >= 300) {
            $error = curl_error($ch);
            curl_close($ch);
            throw new RuntimeException('Error obteniendo token de Microsoft Graph: ' . ($error !== '' ? $error : (string)$response), 500);
        }

        curl_close($ch);
        $json = json_decode((string)$response, true);
        if (!is_array($json) || empty($json['access_token'])) {
            throw new RuntimeException('Respuesta inválida de Microsoft Graph', 500);
        }

        return (string)$json['access_token'];
    }

    private function build_otp_html(string $code): string
    {
        return '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:32px"><div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 2px 8px rgba(0,0,0,.1)"><h2 style="color:#1a1a2e;margin-bottom:8px">Recuperación de contraseña</h2><p style="color:#555;margin-bottom:24px">Recibimos una solicitud para restablecer tu contraseña en el sistema TEXPRO.<br>Usa el siguiente código. <strong>Expira en 15 minutos.</strong></p><div style="text-align:center;margin:32px 0"><span style="display:inline-block;letter-spacing:10px;font-size:40px;font-weight:bold;color:#1a1a2e;background:#f0f4ff;padding:16px 32px;border-radius:8px">' . htmlspecialchars($code, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '</span></div><p style="color:#888;font-size:13px">Si no solicitaste este código, ignora este correo.<br>Tu contraseña actual sigue siendo la misma.</p><hr style="border:none;border-top:1px solid #eee;margin:24px 0"><p style="color:#aaa;font-size:12px;text-align:center">TEXPRO Productos Químicos y Tratamiento de Aguas</p></div></body></html>';
    }
}
