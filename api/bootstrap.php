<?php
declare(strict_types=1);

require_once __DIR__ . '/src/Env.php';
require_once __DIR__ . '/src/Http.php';
require_once __DIR__ . '/src/Database.php';
require_once __DIR__ . '/src/Security.php';
require_once __DIR__ . '/src/Pdf.php';
require_once __DIR__ . '/src/Services.php';
require_once __DIR__ . '/src/SharedServiceHelpers.php';
require_once __DIR__ . '/src/AnalyticsService.php';
require_once __DIR__ . '/src/SalesService.php';
require_once __DIR__ . '/src/AdminService.php';
require_once __DIR__ . '/src/RrhhService.php';
require_once __DIR__ . '/src/AlertasService.php';
require_once __DIR__ . '/src/MensajeriaService.php';
require_once __DIR__ . '/src/NotificacionesService.php';
require_once __DIR__ . '/src/VendedoresService.php';
require_once __DIR__ . '/src/DashboardService.php';
require_once __DIR__ . '/src/GerenciaService.php';
require_once __DIR__ . '/src/VentasService.php';
require_once __DIR__ . '/src/IndicadoresService.php';
require_once __DIR__ . '/src/LaboratorioService.php';
require_once __DIR__ . '/src/ApiApplication.php';

$envPath = dirname(__DIR__) . DIRECTORY_SEPARATOR . '.env';
if (is_file($envPath)) {
    load_env_file($envPath);
}

$timezone = env('APP_TIMEZONE', 'America/Santiago');
@date_default_timezone_set((string)$timezone);
