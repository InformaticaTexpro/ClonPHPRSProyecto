<?php
declare(strict_types=1);

require_once __DIR__ . '/../../../../api/bootstrap.php';

function h(mixed $value): string
{
    return htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function normalize_login_area(string $value): string
{
    $text = trim(mb_strtolower($value));
    $text = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $text) ?: $text;
    $text = preg_replace('/[^a-z0-9]+/', '_', $text) ?? $text;
    return trim($text, '_');
}

function resolve_login_route(array $user): string
{
    $menus = array_values(array_filter(array_map(static function (array $menu): array {
        return [
            'codigo' => normalize_login_area((string)($menu['codigo'] ?? '')),
            'url' => trim((string)($menu['url'] ?? '')),
            'orden' => (int)($menu['orden'] ?? 0),
            'nombre' => trim((string)($menu['nombre'] ?? '')),
        ];
    }, $user['menus'] ?? []), static fn(array $menu): bool => $menu['url'] !== ''));

    $preferidas = [
        'ventas' => '/src/modulo/ventas/dashboard/index.html',
        'venta' => '/src/modulo/ventas/dashboard/index.html',
        'vendedores' => '/src/modulo/ventas/dashboard/index.html',
        'comercial' => '/src/modulo/ventas/dashboard/index.html',
        'gerencia' => '/src/modulo/gerencia/dashboard-comercial/index.html',
        'produccion' => '/src/modulo/produccion/produccion/index.html',
        'bodega' => '/src/modulo/bodega/bodega/index.html',
        'facturacion' => '/src/modulo/facturacion/facturacion/index.html',
        'rrhh' => '/src/modulo/rrhh/rrhh/index.html',
        'recursos_humanos' => '/src/modulo/rrhh/rrhh/index.html',
        'general' => '/src/modulo/general/general/index.html',
        'contabilidad' => '/src/modulo/contabilidad/contabilidad/index.html',
        'cobranza' => '/src/modulo/contabilidad/contabilidad/index.html',
        'servicio_tecnico' => '/src/modulo/servtecnico/servicio-tecnico/index.html',
        'servicio' => '/src/modulo/servtecnico/servicio-tecnico/index.html',
        'serv_tecnico' => '/src/modulo/servtecnico/servicio-tecnico/index.html',
        'laboratorio' => '/src/modulo/laboratorio/ingreso-muestras/index.html',
        'administracion' => '/src/modulo/admin/admin/index.html',
        'admin' => '/src/modulo/admin/admin/index.html',
    ];

    $area = normalize_login_area((string)($user['area'] ?? ''));
    $preferida = $preferidas[$area] ?? null;
    if ($preferida) {
        foreach ($menus as $menu) {
            if ($menu['url'] === $preferida) {
                return $preferida;
            }
        }
    }

    usort($menus, static function (array $a, array $b): int {
        return ($a['orden'] <=> $b['orden']) ?: strcmp($a['nombre'], $b['nombre']);
    });

    foreach ($menus as $menu) {
        return $menu['url'];
    }

    return '/src/sin-acceso.html';
}

$authService = new AuthService(new Database());
$error = '';
$usuarioValue = '';
$logoutRequested = isset($_GET['logout']);
$loginResponse = null;

if ($logoutRequested) {
    clear_auth_cookie();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $usuarioValue = trim((string)($_POST['usuario'] ?? ''));
    $password = (string)($_POST['password'] ?? '');

    try {
        $loginResponse = $authService->login($usuarioValue, $password);
        if (!empty($loginResponse['token'])) {
            set_auth_cookie((string)$loginResponse['token']);
        }
    } catch (Throwable $e) {
        $error = $e->getMessage();
    }
}
?>
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GICOTEX - Iniciar Sesion</title>
  <link rel="icon" type="image/png" href="/src/assets/images/Isotipo-TEXPRO.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=Open+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/src/assets/styles/tokens.css?v=2.1.0" />
  <link rel="stylesheet" href="/src/modulo/varios/login/login.css?v=2.1.0" />
</head>
<body>
  <div class="login-wrapper">
    <div class="login-brand">
      <div class="brand-content">
        <img
          src="/src/assets/images/Isotipo-TEXPRO_fondo_blanco.png"
          alt="GICOTEX Logo"
          class="brand-logo"
          onerror="this.style.display='none'; document.getElementById('brand-fallback').style.display='flex';"
        />
        <div class="brand-wordmark" aria-label="GICOTEX">
          <span class="brand-kicker">Sistema de Gestion Interna</span>
          <h1 class="brand-name">GICOTEX</h1>
        </div>
        <div id="brand-fallback" class="brand-fallback" style="display:none;">
          <div class="brand-isotipo">⚙️</div>
          <h1 class="brand-name">GICOTEX</h1>
          <p class="brand-tagline">Productos Quimicos y Tratamiento de Aguas</p>
        </div>
        <div class="brand-footer">
          <span class="brand-cert">ISO 9001:2015 · ISP · CITUC</span>
        </div>
      </div>
    </div>

    <div class="login-panel">
      <div class="login-card">
        <div class="login-logo-mobile">
          <img
            src="/src/assets/images/Isotipo-TEXPRO_fondo_blanco.png"
            alt="GICOTEX"
            class="login-isotipo-mobile"
          />
        </div>

        <div class="login-header">
          <h2 class="login-title">Bienvenido</h2>
          <p class="login-subtitle">Ingresa tus credenciales para acceder al sistema</p>
        </div>

        <?php if ($error !== ''): ?>
          <div class="alert-error" style="display:flex;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
            <span><?= h($error) ?></span>
          </div>
        <?php endif; ?>

        <?php if (is_array($loginResponse) && !empty($loginResponse['token'])): ?>
          <?php
            $redirectRoute = resolve_login_route($loginResponse['user'] ?? []);
            $payload = [
              'token' => (string)$loginResponse['token'],
              'user' => $loginResponse['user'] ?? null,
              'allMenus' => $loginResponse['allMenus'] ?? [],
              'redirect' => $redirectRoute,
            ];
          ?>
          <div class="alert-success" style="display:flex;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/><circle cx="12" cy="12" r="10"/></svg>
            <span>Ingreso correcto. Redirigiendo...</span>
          </div>
          <script>
            (function () {
              const payload = <?= json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?>;
              if (payload.token) {
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                localStorage.removeItem('usuario');
                sessionStorage.removeItem('texpro_user');
                localStorage.setItem('token', payload.token);
                if (payload.user) {
                  const userPayload = JSON.stringify(payload.user);
                  sessionStorage.setItem('texpro_user', userPayload);
                  localStorage.setItem('user', userPayload);
                  localStorage.setItem('usuario', userPayload);
                }
              }
              window.location.href = payload.redirect || '/src/sin-acceso.html';
            })();
          </script>
        <?php endif; ?>

        <form class="login-form" method="post" action="">
          <div class="form-group">
            <label class="form-label" for="usuario">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
              Correo electronico
            </label>
            <input
              type="text"
              id="usuario"
              name="usuario"
              class="form-input"
              placeholder="tucorreo@texpro.cl"
              autocomplete="username"
              required
              value="<?= h($usuarioValue) ?>"
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="password">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              Contrasena
            </label>
            <div class="input-password-wrapper">
              <input
                type="password"
                id="password"
                name="password"
                class="form-input"
                placeholder="Ingresa tu contrasena"
                autocomplete="current-password"
                required
              />
              <button
                type="button"
                id="togglePassword"
                class="btn-toggle-password"
                aria-label="Mostrar contrasena"
                aria-pressed="false"
              >
                <svg class="toggle-password-icon toggle-password-icon--show" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.5 10.5 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.5 10.5 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>
                <svg class="toggle-password-icon toggle-password-icon--hide" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" hidden><path d="m3 3 18 18"/><path d="M10.585 10.585A2 2 0 1 0 13.414 13.414"/><path d="M9.88 4.24A10.45 10.45 0 0 1 12 4c7 0 10 8 10 8a19.6 19.6 0 0 1-4.23 5.19"/><path d="M6.61 6.61A19.8 19.8 0 0 0 2 12s3 8 10 8c1.4 0 2.67-.25 3.83-.68"/></svg>
              </button>
            </div>
          </div>

          <div class="form-options">
            <label class="checkbox-label">
              <input type="checkbox" id="recordar" name="recordar" class="checkbox-input" />
              <span class="checkbox-custom"></span>
              Recordar sesion
            </label>
            <a href="/src/modulo/varios/recuperar-password/index.html" class="link-forgot">¿Olvidaste tu contrasena?</a>
          </div>

          <button type="submit" class="btn-login">
            <span class="btn-text">Iniciar Sesion</span>
          </button>
        </form>

        <div class="login-footer">
          <p>Sistema de Gestion Interna — <strong>GICOTEX</strong></p>
          <p class="version">v2.1.0</p>
        </div>
      </div>
    </div>
  </div>

  <script>
    (function () {
      const input = document.getElementById('password');
      const button = document.getElementById('togglePassword');
      if (!input || !button) return;

      const iconShow = button.querySelector('.toggle-password-icon--show');
      const iconHide = button.querySelector('.toggle-password-icon--hide');

      function setVisible(visible) {
        input.type = visible ? 'text' : 'password';
        button.setAttribute('aria-pressed', visible ? 'true' : 'false');
        button.setAttribute('aria-label', visible ? 'Ocultar contrasena' : 'Mostrar contrasena');
        if (iconShow) iconShow.hidden = visible;
        if (iconHide) iconHide.hidden = !visible;
      }

      button.addEventListener('click', () => {
        setVisible(input.type === 'password');
        input.focus({ preventScroll: true });
      });
    })();
  </script>
</body>
</html>
