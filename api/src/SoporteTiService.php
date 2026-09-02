<?php
declare(strict_types=1);

final class SoporteTiService
{
    use SharedServiceHelpers;

    private const EQUIPO_ESTADOS = ['ACTIVO', 'BAJA', 'MANTENCION', 'RESERVA', 'REVISAR'];
    private const ACTIVIDAD_ESTADOS = ['PENDIENTE', 'EN_PROCESO', 'EN_ESPERA', 'FINALIZADA', 'CANCELADA'];
    private const ACTIVIDAD_PRIORIDADES = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'];
    private const MOVIMIENTO_TIPOS = ['ENTRADA', 'SALIDA', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO'];

    public function __construct(private Database $db)
    {
    }

    public function route(array $payload, string $method, string $path, array $query, array $body): array
    {
        $this->assertModuleAccess($payload);

        if ($method === 'GET' && ($path === '/' || $path === '/dashboard')) {
            return $this->dashboard($payload);
        }

        if ($method === 'GET' && $path === '/configuracion/estandar') {
            return $this->configuracionEstandar();
        }

        if ($method === 'PUT' && $path === '/configuracion/estandar') {
            return $this->actualizarConfiguracionEstandar($payload, $body);
        }

        if ($method === 'GET' && $path === '/equipos') {
            return $this->listarEquipos($payload, $query);
        }

        if ($method === 'POST' && $path === '/equipos') {
            return $this->guardarEquipo($payload, $body);
        }

        if ($method === 'GET' && preg_match('#^/equipos/(\d+)$#', $path, $m)) {
            return $this->verEquipo($payload, (int)$m[1]);
        }

        if ($method === 'PUT' && preg_match('#^/equipos/(\d+)$#', $path, $m)) {
            return $this->guardarEquipo($payload, $body, (int)$m[1]);
        }

        if ($method === 'GET' && preg_match('#^/equipos/(\d+)/historial$#', $path, $m)) {
            return $this->equipoHistorial((int)$m[1]);
        }

        if ($method === 'GET' && preg_match('#^/equipos/(\d+)/mantenciones$#', $path, $m)) {
            return $this->equipoMantenciones((int)$m[1]);
        }

        if ($method === 'GET' && preg_match('#^/equipos/(\d+)/actividades$#', $path, $m)) {
            return $this->equipoActividades((int)$m[1]);
        }

        if ($method === 'GET' && preg_match('#^/equipos/(\d+)/credencial$#', $path, $m)) {
            return $this->verCredencial($payload, (int)$m[1]);
        }

        if ($method === 'POST' && preg_match('#^/equipos/(\d+)/credencial$#', $path, $m)) {
            return $this->guardarCredencial($payload, (int)$m[1], $body);
        }

        if ($method === 'GET' && $path === '/actividades') {
            return $this->listarActividades($payload, $query);
        }

        if ($method === 'POST' && $path === '/actividades') {
            return $this->guardarActividad($payload, $body);
        }

        if ($method === 'GET' && $path === '/responsables') {
            return $this->listarResponsables($payload);
        }

        if ($method === 'GET' && preg_match('#^/actividades/(\d+)$#', $path, $m)) {
            return $this->verActividad((int)$m[1]);
        }

        if ($method === 'PUT' && preg_match('#^/actividades/(\d+)$#', $path, $m)) {
            return $this->guardarActividad($payload, $body, (int)$m[1]);
        }

        if ($method === 'PATCH' && preg_match('#^/actividades/(\d+)/estado$#', $path, $m)) {
            return $this->cambiarEstadoActividad($payload, (int)$m[1], $body);
        }

        if ($method === 'POST' && preg_match('#^/actividades/(\d+)/comentarios$#', $path, $m)) {
            return $this->agregarComentarioActividad($payload, (int)$m[1], $body);
        }

        if ($method === 'GET' && $path === '/mantenciones') {
            return $this->listarMantenciones($payload, $query);
        }

        if ($method === 'GET' && preg_match('#^/mantenciones/(\d+)$#', $path, $m)) {
            return $this->verMantencion($payload, (int)$m[1]);
        }

        if ($method === 'POST' && $path === '/mantenciones') {
            return $this->guardarMantencion($payload, $body);
        }

        if ($method === 'PUT' && preg_match('#^/mantenciones/(\d+)$#', $path, $m)) {
            return $this->guardarMantencion($payload, $body, (int)$m[1]);
        }

        if ($method === 'GET' && $path === '/bodega/productos') {
            return $this->listarProductosBodega($payload, $query);
        }

        if ($method === 'POST' && $path === '/bodega/productos') {
            return $this->guardarProductoBodega($payload, $body);
        }

        if ($method === 'PUT' && preg_match('#^/bodega/productos/(\d+)$#', $path, $m)) {
            return $this->guardarProductoBodega($payload, $body, (int)$m[1]);
        }

        if ($method === 'GET' && $path === '/bodega/movimientos') {
            return $this->listarMovimientosBodega($payload, $query);
        }

        if ($method === 'POST' && $path === '/bodega/movimientos') {
            return $this->guardarMovimientoBodega($payload, $body);
        }

        throw new RuntimeException('Ruta de Soporte TI no encontrada', 404);
    }

    private function assertModuleAccess(array $payload): void
    {
        if ($this->isAdmin($payload) || $this->isSupportArea($payload) || $this->hasSupportMenu($payload)) {
            return;
        }

        throw new RuntimeException('Acceso denegado al mÃƒÆ’Ã‚Â³dulo Soporte TI', 403);
    }

    private function isAdmin(array $payload): bool
    {
        return in_array(($payload['is_admin'] ?? false), [true, 1, '1'], true);
    }

    private function isSupportArea(array $payload): bool
    {
        return $this->normalizeKey($payload['area'] ?? '') === 'soporte-ti';
    }

    private function hasSupportMenu(array $payload): bool
    {
        $menus = $payload['menus'] ?? [];
        if (!is_array($menus)) {
            return false;
        }

        $codes = [
            'soporte_ti_dashboard',
            'soporte_ti_equipos',
            'soporte_ti_actividades',
            'soporte_ti_mantenciones',
            'soporte_ti_bodega',
        ];

        foreach ($menus as $menu) {
            $codigo = $this->normalizeText($menu['codigo'] ?? '');
            if (in_array($codigo, $codes, true)) {
                return true;
            }
        }

        return false;
    }

    private function currentUserIdOrFail(array $payload): int
    {
        return $this->currentUserIdFromPayload($payload);
    }

    private function currentUserName(array $payload): string
    {
        $name = $this->normalizeText($payload['nombre'] ?? $payload['email'] ?? 'Usuario');
        return $name !== '' ? $name : 'Usuario';
    }

    private function normalizeText(mixed $value): string
    {
        return trim((string)$value);
    }

    private function normalizeKey(mixed $value): string
    {
        $text = mb_strtolower($this->normalizeText($value));
        $text = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $text) ?: $text;
        $text = preg_replace('/\s+/', '-', $text) ?? $text;
        $text = preg_replace('/[^a-z0-9-]/', '', $text) ?? $text;
        return trim($text, '-');
    }

    private function normalizeBool(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (is_bool($value)) {
            return $value ? 1 : 0;
        }

        $text = mb_strtolower($this->normalizeText($value));
        if (in_array($text, ['1', 'true', 'si', 'sÃƒÆ’Ã‚Â­', 's', 'y', 'yes', 'ok', 'activo'], true)) {
            return 1;
        }
        if (in_array($text, ['0', 'false', 'no', 'n', 'inactivo'], true)) {
            return 0;
        }

        return is_numeric($value) ? ((int)$value !== 0 ? 1 : 0) : null;
    }

    private function normalizeMantencionEstado(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        $text = strtoupper(trim($this->normalizeText($value)));
        $text = preg_replace('/\s+/', ' ', $text) ?? $text;

        return match ($text) {
            'PENDIENTE' => 'PENDIENTE',
            'COMPLETADA', 'COMPLETADO', 'REALIZADA', 'REALIZADO', 'HECHA', 'HECHO', 'FINALIZADA', 'FINALIZADO' => 'COMPLETADA',
            'REQUIERE SEGUIMIENTO', 'REQUIERE_SEGUIMIENTO' => 'REQUIERE SEGUIMIENTO',
            'NO RESUELTA', 'NO RESUELTO' => 'NO RESUELTA',
            default => null,
        };
    }

    private function mantencionEstadoLabel(mixed $value): string
    {
        if ($value === null || $value === '') {
            return '—';
        }

        if (is_numeric($value)) {
            return ((int)$value === 1) ? 'COMPLETADA' : 'PENDIENTE';
        }

        $text = strtoupper(trim($this->normalizeText($value)));
        $text = preg_replace('/\s+/', ' ', $text) ?? $text;

        return match ($text) {
            'PENDIENTE' => 'PENDIENTE',
            'COMPLETADA', 'COMPLETADO', 'REALIZADA', 'REALIZADO', 'HECHA', 'HECHO', 'FINALIZADA', 'FINALIZADO' => 'COMPLETADA',
            'REQUIERE SEGUIMIENTO', 'REQUIERE_SEGUIMIENTO' => 'REQUIERE SEGUIMIENTO',
            'NO RESUELTA', 'NO RESUELTO' => 'NO RESUELTA',
            default => 'PENDIENTE',
        };
    }

    private function normalizeDate(mixed $value): ?string
    {
        $text = $this->normalizeText($value);
        if ($text === '') {
            return null;
        }

        try {
            return (new DateTimeImmutable($text))->format('Y-m-d');
        } catch (Throwable) {
            return null;
        }
    }

    private function normalizeDateTime(mixed $value): ?string
    {
        $text = $this->normalizeText($value);
        if ($text === '') {
            return null;
        }

        try {
            return (new DateTimeImmutable($text))->format('Y-m-d H:i:s');
        } catch (Throwable) {
            return null;
        }
    }

    private function normalizeInt(mixed $value): int
    {
        return (int)preg_replace('/[^0-9-]/', '', (string)$value);
    }

    private function normalizeDecimal(mixed $value): float
    {
        $text = str_replace([' ', ','], ['', '.'], $this->normalizeText($value));
        $text = preg_replace('/[^0-9.\-]/', '', $text);
        if ($text === '' || !is_numeric($text)) {
            return 0.0;
        }

        return (float)$text;
    }

    private function resolveEquipoId(mixed $value): ?int
    {
        $text = $this->normalizeText($value);
        if ($text === '') {
            return null;
        }

        $row = $this->db->fetchOne('SELECT id FROM ti_equipo WHERE codigo_equipo = ? LIMIT 1', [$text]);
        if ($row) {
            return (int)$row['id'];
        }

        if (ctype_digit($text)) {
            $row = $this->db->fetchOne('SELECT id FROM ti_equipo WHERE id = ? LIMIT 1', [(int)$text]);
            return $row ? (int)$row['id'] : null;
        }

        return null;
    }

    private function resolveActividadId(mixed $value): ?int
    {
        $text = $this->normalizeText($value);
        if ($text === '') {
            return null;
        }

        $row = $this->db->fetchOne('SELECT id FROM ti_actividad WHERE numero = ? LIMIT 1', [$text]);
        if ($row) {
            return (int)$row['id'];
        }

        if (ctype_digit($text)) {
            $row = $this->db->fetchOne('SELECT id FROM ti_actividad WHERE id = ? LIMIT 1', [(int)$text]);
            return $row ? (int)$row['id'] : null;
        }

        return null;
    }

    private function resolveEntregadoUsuarioId(mixed $value): ?int
    {
        $text = $this->normalizeText($value);
        if ($text === '' || !ctype_digit($text)) {
            return null;
        }

        $row = $this->db->fetchOne('SELECT id FROM usuario WHERE id = ? LIMIT 1', [(int)$text]);
        return $row ? (int)$row['id'] : null;
    }

    private function resolveEntregadoUsuarioName(mixed $value): string
    {
        $text = $this->normalizeText($value);
        if ($text === '' || !ctype_digit($text)) {
            throw new RuntimeException('El usuario entregado es requerido', 400);
        }

        $row = $this->db->fetchOne('SELECT id, nombre FROM usuario WHERE id = ? LIMIT 1', [(int)$text]);
        if (!$row) {
            throw new RuntimeException('El usuario entregado no existe', 400);
        }

        return $this->normalizeText($row['nombre'] ?? '');
    }

    private function resolveBodegaProductoId(mixed $value): ?int
    {
        $text = $this->normalizeText($value);
        if ($text === '' || !preg_match('/^(0|[1-9]\d*)$/', $text)) {
            return null;
        }

        $row = $this->db->fetchOne('SELECT id FROM ti_bodega_producto WHERE id = ? LIMIT 1', [(int)$text]);
        return $row ? (int)$row['id'] : null;
    }

    private function obtenerStockActualBodegaProducto(int $productoId): float
    {
        $row = $this->db->fetchOne(
            "SELECT
                p.stock_inicial
                + COALESCE((
                    SELECT SUM(
                        CASE
                            WHEN m.tipo_movimiento IN ('ENTRADA', 'AJUSTE_POSITIVO') THEN m.cantidad
                            WHEN m.tipo_movimiento IN ('SALIDA', 'AJUSTE_NEGATIVO') THEN -m.cantidad
                            ELSE 0
                        END
                    )
                    FROM ti_bodega_movimiento m
                    WHERE m.producto_id = p.id
                ), 0) AS stock_actual
             FROM ti_bodega_producto p
             WHERE p.id = ?",
            [$productoId]
        );

        return (float)($row['stock_actual'] ?? 0);
    }

    private function resolveResponsableUsuarioId(mixed $value): ?int
    {
        $text = $this->normalizeText($value);
        if ($text === '') {
            return null;
        }

        $row = $this->db->fetchOne(
            'SELECT id
             FROM usuario
             WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?))
                OR LOWER(TRIM(email)) = LOWER(TRIM(?))
                OR TRIM(codigo) = TRIM(?)
             LIMIT 1',
            [$text, $text, $text]
        );
        if ($row) {
            return (int)$row['id'];
        }

        if (ctype_digit($text)) {
            $row = $this->db->fetchOne('SELECT id FROM usuario WHERE id = ? LIMIT 1', [(int)$text]);
            return $row ? (int)$row['id'] : null;
        }

        return null;
    }

    private function normalizeFloat(mixed $value): ?float
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (is_numeric($value)) {
            return (float)$value;
        }

        $text = str_replace(['$', ' '], '', (string)$value);
        $text = str_replace('.', '', $text);
        $text = str_replace(',', '.', $text);
        return is_numeric($text) ? (float)$text : null;
    }

    private function arrayOrEmpty(mixed $value): array
    {
        return is_array($value) ? $value : [];
    }

    private function configRows(): array
    {
        $row = $this->db->fetchOne(
            'SELECT nombre, cpu_minima, ram_minima_gb, activo
             FROM ti_estandar_config
             WHERE activo = 1
             ORDER BY id ASC
             LIMIT 1'
        );

        return [
            'nombre' => $this->normalizeText($row['nombre'] ?? 'EstÃƒÆ’Ã‚Â¡ndar TI corporativo'),
            'cpu_minimo_texto' => $this->normalizeText($row['cpu_minima'] ?? 'Intel Core i5'),
            'ram_minima_gb' => isset($row['ram_minima_gb']) ? (float)$row['ram_minima_gb'] : 16.0,
        ];
    }

    private function evaluateStandard(?string $cpu, ?float $ramGb, array $config): array
    {
        $cpu = $this->normalizeText($cpu);
        $cpuUpper = mb_strtoupper($cpu);
        $ramMin = (float)($config['ram_minima_gb'] ?? 16);
        $cpuMinText = mb_strtoupper($this->normalizeText($config['cpu_minimo_texto'] ?? 'Intel Core i5'));

        if ($cpu === '' || $ramGb === null) {
            return [
                'estado_estandar' => 'SIN INFORMACIÃƒÆ’Ã¢â‚¬Å“N',
                'cumple_estandar' => null,
                'cpu_referencia' => $cpuMinText,
                'ram_referencia' => $ramMin,
            ];
        }

        $allowCpu = preg_match('/\b(I5|I7|I9)\b/i', $cpuUpper) === 1 || str_contains($cpuUpper, 'CORE I5');
        $denyCpu = preg_match('/\b(I3|CELERON|PENTIUM|ATOM)\b/i', $cpuUpper) === 1;
        $ramOk = $ramGb >= $ramMin;

        if ($allowCpu && $ramOk) {
            return [
                'estado_estandar' => 'CUMPLE',
                'cumple_estandar' => 1,
                'cpu_referencia' => $cpuMinText,
                'ram_referencia' => $ramMin,
            ];
        }

        if ($denyCpu || !$ramOk) {
            return [
                'estado_estandar' => 'NO CUMPLE',
                'cumple_estandar' => 0,
                'cpu_referencia' => $cpuMinText,
                'ram_referencia' => $ramMin,
            ];
        }

        return [
            'estado_estandar' => 'NO CUMPLE',
            'cumple_estandar' => 0,
            'cpu_referencia' => $cpuMinText,
            'ram_referencia' => $ramMin,
        ];
    }

    private function equipmentQueryBase(string $where = '', array $params = []): array
    {
        $sql = 'SELECT
                    e.id,
                    e.codigo_equipo,
                    e.tipo_equipo,
                    e.area,
                    e.usuario_asignado,
                    e.rol_equipo,
                    e.ip_actual,
                    e.estado,
                    e.fecha_alta,
                    e.fecha_baja,
                    e.licencias,
                    e.accesos_ip,
                    e.observaciones,
                    h.generacion_procesador,
                    h.descripcion_procesador,
                    h.ram_gb,
                    h.generacion_ram,
                    h.tipo_equipo_fisico,
                    h.almacenamiento_principal,
                    h.almacenamiento_secundario,
                    h.estado_disco,
                    h.placa_madre,
                    h.red,
                    h.wifi,
                    h.sistema_operativo,
                    h.licencia_so AS licencia_hardware,
                    s.tipo_cuenta,
                    s.antivirus,
                    s.antivirus_activo,
                    s.firewall_activo AS firewall,
                    s.ultima_actualizacion_so,
                    s.estado_seguridad,
                    s.observaciones AS observaciones_seguridad
                FROM ti_equipo e
                LEFT JOIN ti_equipo_hardware h ON h.equipo_id = e.id
                LEFT JOIN ti_equipo_seguridad s ON s.equipo_id = e.id';

        if ($where !== '') {
            $sql .= ' WHERE ' . $where;
        }

        $sql .= ' ORDER BY e.codigo_equipo ASC';
        return $this->db->fetchAll($sql, $params);
    }

    private function dashboard(array $payload): array
    {
        $config = $this->configRows();
        $now = new DateTimeImmutable('now');
        $anio = (int)$now->format('Y');
        $mes = (int)$now->format('n');
        $monthStart = sprintf('%04d-%02d-01 00:00:00', $anio, $mes);
        $nextMonth = (new DateTimeImmutable($monthStart))->modify('first day of next month')->format('Y-m-d H:i:s');

        $equiposActivos = (int)($this->db->fetchOne("SELECT COUNT(*) AS total FROM ti_equipo WHERE estado = 'ACTIVO'")['total'] ?? 0);
        $equiposBaja = (int)($this->db->fetchOne("SELECT COUNT(*) AS total FROM ti_equipo WHERE estado = 'BAJA'")['total'] ?? 0);
        $equiposSinInfo = (int)($this->db->fetchOne(
            "SELECT COUNT(*) AS total
             FROM ti_equipo e
             LEFT JOIN ti_equipo_hardware h ON h.equipo_id = e.id
             WHERE e.estado = 'ACTIVO'
               AND (COALESCE(TRIM(h.descripcion_procesador), '') = '' OR h.ram_gb IS NULL)"
        )['total'] ?? 0);

        $equiposCumplen = (int)($this->db->fetchOne(
            "SELECT COUNT(*) AS total
             FROM ti_equipo e
             INNER JOIN ti_equipo_hardware h ON h.equipo_id = e.id
             WHERE e.estado = 'ACTIVO'
               AND COALESCE(TRIM(h.descripcion_procesador), '') <> ''
               AND h.ram_gb IS NOT NULL
               AND (
                    LOWER(h.descripcion_procesador) REGEXP '(^|[^a-z0-9])(i5|i7|i9)([^a-z0-9]|$)'
                 OR LOWER(CONCAT_WS(' ', COALESCE(h.generacion_procesador, ''), COALESCE(h.descripcion_procesador, ''))) REGEXP '(^|[^a-z0-9])(i5|i7|i9)([^a-z0-9]|$)'
               )
               AND CAST(h.ram_gb AS DECIMAL(10,2)) >= ?",
            [$config['ram_minima_gb']]
        )['total'] ?? 0);

        $equiposFuera = (int)($this->db->fetchOne(
            "SELECT COUNT(*) AS total
             FROM ti_equipo e
             LEFT JOIN ti_equipo_hardware h ON h.equipo_id = e.id
             WHERE e.estado = 'ACTIVO'
               AND COALESCE(TRIM(h.descripcion_procesador), '') <> ''
               AND h.ram_gb IS NOT NULL
               AND NOT (
                    LOWER(h.descripcion_procesador) REGEXP '(^|[^a-z0-9])(i5|i7|i9)([^a-z0-9]|$)'
                 OR LOWER(CONCAT_WS(' ', COALESCE(h.generacion_procesador, ''), COALESCE(h.descripcion_procesador, ''))) REGEXP '(^|[^a-z0-9])(i5|i7|i9)([^a-z0-9]|$)'
               OR CAST(h.ram_gb AS DECIMAL(10,2)) >= ?
               )",
            [$config['ram_minima_gb']]
        )['total'] ?? 0);

        $solPendientes = (int)($this->db->fetchOne("SELECT COUNT(*) AS total FROM ti_actividad WHERE estado = 'PENDIENTE'")['total'] ?? 0);
        $solProceso = (int)($this->db->fetchOne("SELECT COUNT(*) AS total FROM ti_actividad WHERE estado = 'EN_PROCESO'")['total'] ?? 0);
        $solVencidas = (int)($this->db->fetchOne(
            "SELECT COUNT(*) AS total
             FROM ti_actividad
             WHERE estado NOT IN ('FINALIZADA', 'CANCELADA')
               AND fecha_objetivo IS NOT NULL
               AND fecha_objetivo < NOW()"
        )['total'] ?? 0);
        $solFinalizadas = (int)($this->db->fetchOne(
            "SELECT COUNT(*) AS total
             FROM ti_actividad
             WHERE estado = 'FINALIZADA'
               AND fecha_cierre >= ?
               AND fecha_cierre < ?",
            [$monthStart, $nextMonth]
        )['total'] ?? 0);

        $mantencionesMes = (int)($this->db->fetchOne(
            "SELECT COUNT(*) AS total
             FROM ti_mantencion
             WHERE fecha_mantencion >= ?
               AND fecha_mantencion < ?",
            [substr($monthStart, 0, 10), substr($nextMonth, 0, 10)]
        )['total'] ?? 0);

        $productosBajoStock = (int)($this->db->fetchOne(
            "SELECT COUNT(*) AS total
             FROM ti_bodega_producto p
             WHERE p.activo = 1
               AND (
                 p.stock_inicial
                 + COALESCE((
                     SELECT SUM(
                         CASE
                           WHEN m.tipo_movimiento IN ('ENTRADA', 'AJUSTE_POSITIVO') THEN m.cantidad
                           WHEN m.tipo_movimiento IN ('SALIDA', 'AJUSTE_NEGATIVO') THEN -m.cantidad
                           ELSE 0
                         END
                     )
                     FROM ti_bodega_movimiento m
                     WHERE m.producto_id = p.id
                 ), 0)
               ) <= p.stock_minimo"
        )['total'] ?? 0);

        $equiposFueraListado = $this->equipmentQueryBase(
            "e.estado = 'ACTIVO'
             AND COALESCE(TRIM(h.descripcion_procesador), '') <> ''
             AND h.ram_gb IS NOT NULL
             AND NOT (
               (
                    LOWER(h.descripcion_procesador) REGEXP '(^|[^a-z0-9])(i5|i7|i9)([^a-z0-9]|$)'
                 OR LOWER(CONCAT_WS(' ', COALESCE(h.generacion_procesador, ''), COALESCE(h.descripcion_procesador, ''))) REGEXP '(^|[^a-z0-9])(i5|i7|i9)([^a-z0-9]|$)'
               )
               AND CAST(h.ram_gb AS DECIMAL(10,2)) >= ?
             )",
            [$config['ram_minima_gb']]
        );
        $equiposFueraListado = array_slice(array_map(fn (array $row) => $this->equiposToViewRow($row, $config), $equiposFueraListado), 0, 8);

        $actividadesRecientes = $this->db->fetchAll(
            "SELECT
                a.id,
                a.numero,
                a.titulo,
                a.estado,
                a.prioridad,
                a.fecha_solicitud,
                a.fecha_objetivo,
                a.solicitante,
                a.area,
                a.responsable_usuario_id,
                u.nombre AS responsable_nombre,
                a.equipo_id,
                e.codigo_equipo AS equipo_codigo
             FROM ti_actividad a
             LEFT JOIN ti_equipo e ON e.id = a.equipo_id
             LEFT JOIN usuario u ON u.id = a.responsable_usuario_id
             ORDER BY a.creado_en DESC
             LIMIT 8"
        );
        $actividadesRecientes = array_map(fn (array $row) => $this->actividadToViewRow($row), $actividadesRecientes);

        $mantencionesRecientes = $this->db->fetchAll(
            "SELECT
                m.id,
                m.fecha_mantencion,
                m.tipo_mantencion,
                m.motivo,
                m.resultado_ok AS resultado,
                m.mantencion_realizada AS mantencion,
                m.tecnico_responsable,
                e.codigo_equipo
             FROM ti_mantencion m
             INNER JOIN ti_equipo e ON e.id = m.equipo_id
             ORDER BY COALESCE(m.fecha_mantencion, m.creado_en) DESC
             LIMIT 8"
        );
        $mantencionesRecientes = array_map(function (array $row): array {
            $row['resultado'] = $this->mantencionEstadoLabel($row['resultado'] ?? null);
            $row['mantencion'] = $row['mantencion'] === null ? null : (int)$row['mantencion'];
            return $row;
        }, $mantencionesRecientes);

        $productosBajoStockListado = $this->db->fetchAll(
            "SELECT
                p.id,
                p.codigo AS codigo_producto,
                p.categoria,
                p.descripcion,
                p.stock_inicial,
                p.stock_minimo,
                p.ubicacion,
                p.activo,
                COALESCE((
                    SELECT COUNT(*)
                    FROM ti_bodega_movimiento m
                    WHERE m.producto_id = p.id
                ), 0) AS movimientos_count,
                (
                  p.stock_inicial
                  + COALESCE((
                      SELECT SUM(
                          CASE
                            WHEN m.tipo_movimiento IN ('ENTRADA', 'AJUSTE_POSITIVO') THEN m.cantidad
                            WHEN m.tipo_movimiento IN ('SALIDA', 'AJUSTE_NEGATIVO') THEN -m.cantidad
                            ELSE 0
                          END
                      )
                      FROM ti_bodega_movimiento m
                      WHERE m.producto_id = p.id
                  ), 0)
                ) AS stock_actual
             FROM ti_bodega_producto p
             WHERE p.activo = 1
             HAVING stock_actual <= p.stock_minimo
             ORDER BY p.categoria ASC, p.descripcion ASC
             LIMIT 8"
        );

        $productosBajoStockListado = array_map(fn (array $row) => $this->productoToViewRow($row), $productosBajoStockListado);

        return [
            'ok' => true,
            'configuracion' => $config,
            'kpis' => [
                'equipos_activos' => $equiposActivos,
                'equipos_baja' => $equiposBaja,
                'equipos_cumplen' => $equiposCumplen,
                'equipos_fuera' => $equiposFuera,
                'equipos_sin_info' => $equiposSinInfo,
                'solicitudes_pendientes' => $solPendientes,
                'solicitudes_proceso' => $solProceso,
                'solicitudes_vencidas' => $solVencidas,
                'solicitudes_finalizadas_mes' => $solFinalizadas,
                'mantenciones_mes' => $mantencionesMes,
                'productos_bajo_stock' => $productosBajoStock,
            ],
            'equipos_fuera_estandar' => $equiposFueraListado,
            'actividades_recientes' => $actividadesRecientes,
            'mantenciones_recientes' => $mantencionesRecientes,
            'productos_bajo_stock_lista' => $productosBajoStockListado,
        ];
    }

    private function configuracionEstandar(): array
    {
        return [
            'ok' => true,
            'configuracion' => $this->configRows(),
        ];
    }

    private function actualizarConfiguracionEstandar(array $payload, array $body): array
    {
        $this->assertAdminOrSupport($payload);

        $cpu = $this->normalizeText($body['cpu_minimo_texto'] ?? $body['cpu'] ?? '');
        $ram = $this->normalizeFloat($body['ram_minima_gb'] ?? $body['ram'] ?? null);
        if ($cpu === '') {
            throw new RuntimeException('CPU mÃƒÆ’Ã‚Â­nima requerida', 400);
        }
        if ($ram === null) {
            throw new RuntimeException('RAM mÃƒÆ’Ã‚Â­nima requerida', 400);
        }

        $this->upsertConfig($cpu, $ram, $payload);

        return $this->configuracionEstandar();
    }

    private function upsertConfig(string $cpuMinimoTexto, float $ramMinimaGb, array $payload): void
    {
        $row = $this->db->fetchOne(
            'SELECT id
             FROM ti_estandar_config
             WHERE activo = 1
             ORDER BY id ASC
             LIMIT 1'
        );

        if ($row) {
            $this->db->execute(
                'UPDATE ti_estandar_config
                 SET cpu_minima = ?,
                     ram_minima_gb = ?,
                     actualizado_en = NOW()
                 WHERE id = ?',
                [$cpuMinimoTexto, $ramMinimaGb, (int)$row['id']]
            );
            return;
        }

        $this->db->execute(
            'INSERT INTO ti_estandar_config (nombre, cpu_minima, ram_minima_gb, activo, creado_en, actualizado_en)
             VALUES (?, ?, ?, 1, NOW(), NOW())',
            ['EstÃƒÂ¡ndar TI corporativo', $cpuMinimoTexto, $ramMinimaGb]
        );
    }

    private function assertAdminOrSupport(array $payload): void
    {
        if ($this->isAdmin($payload) || $this->isSupportArea($payload) || $this->hasSupportMenu($payload)) {
            return;
        }

        throw new RuntimeException('Acceso denegado', 403);
    }

    private function listarEquipos(array $payload, array $query): array
    {
        $this->assertModuleAccess($payload);
        $config = $this->configRows();
        $estado = $this->normalizeText($query['estado'] ?? '');
        $area = $this->normalizeText($query['area'] ?? '');
        $tipo = $this->normalizeText($query['tipo'] ?? '');
        $usuario = $this->normalizeText($query['usuario'] ?? '');
        $cumplimiento = $this->normalizeText($query['cumplimiento'] ?? '');
        $search = $this->normalizeText($query['search'] ?? $query['q'] ?? '');

        $conditions = [];
        $params = [];
        if ($estado !== '') {
            $conditions[] = 'e.estado = ?';
            $params[] = $estado;
        }
        if ($area !== '') {
            $conditions[] = 'e.area = ?';
            $params[] = $area;
        }
        if ($tipo !== '') {
            $conditions[] = 'e.tipo_equipo = ?';
            $params[] = $tipo;
        }
        if ($usuario !== '') {
            $conditions[] = 'e.usuario_asignado LIKE ?';
            $params[] = '%' . $usuario . '%';
        }
        if ($search !== '') {
            $conditions[] = '(e.codigo_equipo LIKE ? OR e.usuario_asignado LIKE ? OR e.ip_actual LIKE ? OR e.area LIKE ?)';
            $params[] = '%' . $search . '%';
            $params[] = '%' . $search . '%';
            $params[] = '%' . $search . '%';
            $params[] = '%' . $search . '%';
        }

        $rows = $this->equipmentQueryBase($conditions ? implode(' AND ', $conditions) : '', $params);
        $equipos = [];
        foreach ($rows as $row) {
            $view = $this->equiposToViewRow($row, $config);
            if ($cumplimiento !== '') {
                $cmp = $this->normalizeKey($view['estado_estandar'] ?? '');
                if ($cmp !== $this->normalizeKey($cumplimiento)) {
                    continue;
                }
            }
            $equipos[] = $view;
        }

        return [
            'ok' => true,
            'configuracion' => $config,
            'equipos' => $equipos,
            'filtros' => [
                'estado' => $estado,
                'area' => $area,
                'tipo' => $tipo,
                'usuario' => $usuario,
                'cumplimiento' => $cumplimiento,
                'search' => $search,
            ],
        ];
    }

    private function equiposToViewRow(array $row, array $config): array
    {
        $cpu = $this->normalizeText($row['descripcion_procesador'] ?? $row['generacion_procesador'] ?? '');
        $ram = isset($row['ram_gb']) && $row['ram_gb'] !== null ? (float)$row['ram_gb'] : null;
        $standard = $this->evaluateStandard($cpu, $ram, $config);

        return [
            'id' => (int)($row['id'] ?? 0),
            'codigo_equipo' => $this->normalizeText($row['codigo_equipo'] ?? ''),
            'tipo_equipo' => $this->normalizeText($row['tipo_equipo'] ?? ''),
            'area' => $this->normalizeText($row['area'] ?? ''),
            'usuario_asignado' => $this->normalizeText($row['usuario_asignado'] ?? ''),
            'rol_equipo' => $this->normalizeText($row['rol_equipo'] ?? ''),
            'ip_actual' => $this->normalizeText($row['ip_actual'] ?? ''),
            'estado' => $this->normalizeText($row['estado'] ?? ''),
            'fecha_alta' => $this->normalizeDate($row['fecha_alta'] ?? null),
            'fecha_baja' => $this->normalizeDate($row['fecha_baja'] ?? null),
            'licencias' => $this->normalizeText($row['licencias'] ?? ''),
            'accesos_ip' => $this->normalizeText($row['accesos_ip'] ?? ''),
            'observaciones' => $this->normalizeText($row['observaciones'] ?? ''),
            'hardware' => [
                'generacion_procesador' => $this->normalizeText($row['generacion_procesador'] ?? ''),
                'descripcion_procesador' => $cpu,
                'ram_gb' => $ram,
                'generacion_ram' => $this->normalizeText($row['generacion_ram'] ?? ''),
                'tipo_equipo_fisico' => $this->normalizeText($row['tipo_equipo_fisico'] ?? ''),
                'almacenamiento_principal' => $this->normalizeText($row['almacenamiento_principal'] ?? ''),
                'almacenamiento_secundario' => $this->normalizeText($row['almacenamiento_secundario'] ?? ''),
                'estado_disco' => $this->normalizeText($row['estado_disco'] ?? ''),
                'placa_madre' => $this->normalizeText($row['placa_madre'] ?? ''),
                'red' => $this->normalizeText($row['red'] ?? ''),
                'wifi' => $this->normalizeText($row['wifi'] ?? ''),
                'sistema_operativo' => $this->normalizeText($row['sistema_operativo'] ?? ''),
                'licencia' => $this->normalizeText($row['licencia_hardware'] ?? ''),
            ],
            'seguridad' => [
                'tipo_cuenta' => $this->normalizeText($row['tipo_cuenta'] ?? ''),
                'antivirus' => $this->normalizeText($row['antivirus'] ?? ''),
                'antivirus_activo' => $row['antivirus_activo'] === null ? null : (int)$row['antivirus_activo'],
                'firewall' => $row['firewall'] === null ? null : (int)$row['firewall'],
                'ultima_actualizacion_so' => $this->normalizeDate($row['ultima_actualizacion_so'] ?? null),
                'estado_seguridad' => $this->normalizeText($row['estado_seguridad'] ?? ''),
                'observaciones' => $this->normalizeText($row['observaciones_seguridad'] ?? ''),
            ],
            'estado_estandar' => $standard['estado_estandar'],
            'cumple_estandar' => $standard['cumple_estandar'],
            'cpu_referencia' => $standard['cpu_referencia'],
            'ram_referencia' => $standard['ram_referencia'],
        ];
    }

    private function verEquipo(array $payload, int $equipoId): array
    {
        $this->assertModuleAccess($payload);
        $config = $this->configRows();
        $row = $this->db->fetchOne(
            'SELECT
                e.*,
                h.generacion_procesador,
                h.descripcion_procesador,
                h.ram_gb,
                h.generacion_ram,
                h.tipo_equipo_fisico,
                h.almacenamiento_principal,
                h.almacenamiento_secundario,
                h.estado_disco,
                h.placa_madre,
                h.red,
                h.wifi,
                h.sistema_operativo,
                    h.licencia_so AS licencia_hardware,
                s.tipo_cuenta,
                s.antivirus,
                s.antivirus_activo,
                    s.firewall_activo AS firewall,
                s.ultima_actualizacion_so,
                s.estado_seguridad,
                s.observaciones AS observaciones_seguridad
             FROM ti_equipo e
             LEFT JOIN ti_equipo_hardware h ON h.equipo_id = e.id
             LEFT JOIN ti_equipo_seguridad s ON s.equipo_id = e.id
             WHERE e.id = ?
             LIMIT 1',
            [$equipoId]
        );

        if (!$row) {
            throw new RuntimeException('Equipo no encontrado', 404);
        }

        $view = $this->equiposToViewRow($row, $config);
        $view['historial'] = $this->equipoHistorial($equipoId)['historial'];
        $view['mantenciones'] = $this->equipoMantenciones($equipoId)['mantenciones'];
        $view['actividades'] = $this->equipoActividades($equipoId)['actividades'];
        $view['credencial'] = $this->credentialSummary($equipoId, false);
        return ['ok' => true, 'equipo' => $view];
    }

    private function equipoHistorial(int $equipoId): array
    {
        $historial = $this->db->fetchAll(
            'SELECT h.id,
                    h.tipo_evento AS accion,
                    COALESCE(h.descripcion, CONCAT_WS(" ", h.campo, h.valor_anterior, h.valor_nuevo)) AS detalle,
                    h.usuario_id,
                    u.nombre AS usuario_nombre,
                    h.creado_en AS created_at
             FROM ti_equipo_historial h
             LEFT JOIN usuario u ON u.id = h.usuario_id
             WHERE h.equipo_id = ?
             ORDER BY h.creado_en DESC, h.id DESC',
            [$equipoId]
        );

        return [
            'ok' => true,
            'historial' => array_map(static function (array $row): array {
                return [
                    'id' => (int)($row['id'] ?? 0),
                    'accion' => trim((string)($row['accion'] ?? '')),
                    'detalle' => trim((string)($row['detalle'] ?? '')),
                    'usuario_id' => isset($row['usuario_id']) ? (int)$row['usuario_id'] : null,
                    'usuario_nombre' => trim((string)($row['usuario_nombre'] ?? '')),
                    'created_at' => trim((string)($row['created_at'] ?? '')),
                ];
            }, $historial),
        ];
    }

    private function equipoMantenciones(int $equipoId): array
    {
        $mantenciones = $this->db->fetchAll(
            'SELECT id, tipo_mantencion, motivo, fecha_inicio, fecha_mantencion, tecnico_responsable, so_reinstalado, drivers_ok, disco_revisado, resultado_ok AS resultado, mantencion_realizada AS mantencion, observaciones
             FROM ti_mantencion
             WHERE equipo_id = ?
             ORDER BY COALESCE(fecha_mantencion, creado_en) DESC, id DESC',
            [$equipoId]
        );

        return [
            'ok' => true,
            'mantenciones' => array_map(function (array $row): array {
                return [
                    'id' => (int)($row['id'] ?? 0),
                    'tipo_mantencion' => trim((string)($row['tipo_mantencion'] ?? '')),
                    'motivo' => trim((string)($row['motivo'] ?? '')),
                    'fecha_inicio' => trim((string)($row['fecha_inicio'] ?? '')),
                    'fecha_mantencion' => trim((string)($row['fecha_mantencion'] ?? '')),
                    'tecnico_responsable' => trim((string)($row['tecnico_responsable'] ?? '')),
                    'so_reinstalado' => $row['so_reinstalado'] === null ? null : (int)$row['so_reinstalado'],
                    'drivers_ok' => $row['drivers_ok'] === null ? null : (int)$row['drivers_ok'],
                    'disco_revisado' => $row['disco_revisado'] === null ? null : (int)$row['disco_revisado'],
                    'resultado' => $this->mantencionEstadoLabel($row['resultado'] ?? null),
                    'mantencion' => $row['mantencion'] === null ? null : (int)$row['mantencion'],
                    'observaciones' => trim((string)($row['observaciones'] ?? '')),
                ];
            }, $mantenciones),
        ];
    }

    private function equipoActividades(int $equipoId): array
    {
        $actividades = $this->db->fetchAll(
            'SELECT a.id, a.numero, a.titulo, a.estado, a.prioridad, a.fecha_solicitud, a.fecha_objetivo, u.nombre AS responsable_nombre
             FROM ti_actividad a
             LEFT JOIN usuario u ON u.id = a.responsable_usuario_id
             WHERE equipo_id = ?
             ORDER BY creado_en DESC, id DESC',
            [$equipoId]
        );

        return [
            'ok' => true,
            'actividades' => array_map(static function (array $row): array {
                return [
                    'id' => (int)($row['id'] ?? 0),
                    'numero' => trim((string)($row['numero'] ?? '')),
                    'titulo' => trim((string)($row['titulo'] ?? '')),
                    'estado' => trim((string)($row['estado'] ?? '')),
                    'prioridad' => trim((string)($row['prioridad'] ?? '')),
                    'fecha_solicitud' => trim((string)($row['fecha_solicitud'] ?? '')),
                    'fecha_objetivo' => trim((string)($row['fecha_objetivo'] ?? '')),
                    'responsable_nombre' => trim((string)($row['responsable_nombre'] ?? '')),
                ];
            }, $actividades),
        ];
    }

    private function credentialSummary(int $equipoId, bool $includeSecret = false): array
    {
        $credential = $this->db->fetchOne(
            'SELECT id, equipo_id, tipo, usuario, valor_cifrado, descripcion, activo, creado_en, actualizado_en
             FROM ti_equipo_credencial
             WHERE equipo_id = ?
             ORDER BY actualizado_en DESC, id DESC
             LIMIT 1',
            [$equipoId]
        );

        if (!$credential) {
            return [
                'exists' => false,
                'mask' => 'ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢',
            ];
        }

        $summary = [
            'exists' => true,
            'id' => (int)($credential['id'] ?? 0),
            'tipo' => $this->normalizeText($credential['tipo'] ?? ''),
            'usuario' => $this->normalizeText($credential['usuario'] ?? ''),
            'descripcion' => $this->normalizeText($credential['descripcion'] ?? ''),
            'mask' => 'ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢',
            'created_at' => $this->normalizeText($credential['creado_en'] ?? ''),
            'updated_at' => $this->normalizeText($credential['actualizado_en'] ?? ''),
        ];

        if ($includeSecret) {
            $summary['valor'] = $this->decryptCredential($credential);
        }

        return $summary;
    }

    private function verCredencial(array $payload, int $equipoId): array
    {
        $this->assertAdminOrSupport($payload);
        $credential = $this->db->fetchOne(
            'SELECT id, equipo_id, tipo, usuario, valor_cifrado, descripcion, activo, creado_en, actualizado_en
             FROM ti_equipo_credencial
             WHERE equipo_id = ?
             ORDER BY actualizado_en DESC, id DESC
             LIMIT 1',
            [$equipoId]
        );

        if (!$credential) {
            return [
                'ok' => true,
                'exists' => false,
                'valor' => null,
            ];
        }

        $secret = $this->decryptCredential($credential);
        $this->db->execute(
            'INSERT INTO ti_equipo_historial (equipo_id, tipo_evento, campo, valor_anterior, valor_nuevo, descripcion, usuario_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$equipoId, 'CREDENCIAL_VISTA', 'credencial', null, null, 'Se consultÃƒÆ’Ã‚Â³ la credencial restringida', $this->currentUserIdOrFail($payload)]
        );

        return [
            'ok' => true,
            'exists' => true,
            'valor' => $secret,
            'tipo' => $this->normalizeText($credential['tipo'] ?? ''),
            'usuario' => $this->normalizeText($credential['usuario'] ?? ''),
            'descripcion' => $this->normalizeText($credential['descripcion'] ?? ''),
            'updated_at' => $this->normalizeText($credential['actualizado_en'] ?? ''),
        ];
    }

    private function guardarCredencial(array $payload, int $equipoId, array $body): array
    {
        $this->assertAdminOrSupport($payload);
        $secreto = $this->normalizeText($body['secreto'] ?? $body['credencial'] ?? '');
        if ($secreto === '') {
            throw new RuntimeException('La credencial es requerida', 400);
        }

        $valorCifrado = $this->encryptCredential($secreto);
        $descripcion = $this->normalizeText($body['descripcion'] ?? '');
        $userId = $this->currentUserIdOrFail($payload);
        $userName = $this->currentUserName($payload);

        $this->db->execute(
            'INSERT INTO ti_equipo_credencial (equipo_id, tipo, usuario, valor_cifrado, descripcion, activo, creado_por, actualizado_por)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?)
             ON DUPLICATE KEY UPDATE
               tipo = VALUES(tipo),
               usuario = VALUES(usuario),
               valor_cifrado = VALUES(valor_cifrado),
               descripcion = VALUES(descripcion),
               activo = VALUES(activo),
               actualizado_por = VALUES(actualizado_por),
               actualizado_en = NOW()',
            [$equipoId, 'LOCAL', $userName, $valorCifrado, $descripcion, $userId, $userId]
        );

        $this->db->execute(
            'INSERT INTO ti_equipo_historial (equipo_id, tipo_evento, campo, valor_anterior, valor_nuevo, descripcion, usuario_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$equipoId, 'CREDENCIAL_ACTUALIZADA', 'credencial', null, null, 'Se actualizÃƒÆ’Ã‚Â³ la credencial restringida', $userId]
        );

        return [
            'ok' => true,
            'credential' => $this->credentialSummary($equipoId, false),
        ];
    }

    private function encryptCredential(string $plain): string
    {
        $keyMaterial = trim((string)env('TI_CREDENTIAL_KEY', ''));
        if ($keyMaterial === '') {
            throw new RuntimeException('Falta TI_CREDENTIAL_KEY en .env', 500);
        }

        $key = hash('sha256', $keyMaterial, true);

        if (function_exists('sodium_crypto_secretbox')) {
            $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
            $cipher = sodium_crypto_secretbox($plain, $nonce, $key);

            return base64_encode(json_encode([
                'alg' => 'sodium-secretbox',
                'nonce' => base64_encode($nonce),
                'cipher' => base64_encode($cipher),
            ], JSON_UNESCAPED_SLASHES));
        }

        if (function_exists('openssl_encrypt')) {
            $ivLength = openssl_cipher_iv_length('aes-256-gcm');
            if ($ivLength === false || $ivLength <= 0) {
                throw new RuntimeException('No fue posible iniciar el cifrado de credenciales', 500);
            }

            $iv = random_bytes($ivLength);
            $tag = '';
            $cipher = openssl_encrypt($plain, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
            if ($cipher === false || $tag === '') {
                throw new RuntimeException('No fue posible cifrar la credencial', 500);
            }

            return base64_encode(json_encode([
                'alg' => 'openssl-aes-256-gcm',
                'iv' => base64_encode($iv),
                'tag' => base64_encode($tag),
                'cipher' => base64_encode($cipher),
            ], JSON_UNESCAPED_SLASHES));
        }

        throw new RuntimeException('No hay un mecanismo disponible para cifrar credenciales', 500);
    }

    private function decryptCredential(array $credential): string
    {
        $keyMaterial = trim((string)env('TI_CREDENTIAL_KEY', ''));
        if ($keyMaterial === '') {
            throw new RuntimeException('Falta TI_CREDENTIAL_KEY en .env', 500);
        }

        $encoded = base64_decode((string)($credential['valor_cifrado'] ?? ''), true);
        if ($encoded === false || $encoded === '') {
            throw new RuntimeException('La credencial almacenada tiene formato inválido', 500);
        }

        $payload = json_decode($encoded, true);
        if (!is_array($payload)) {
            throw new RuntimeException('La credencial almacenada tiene formato inválido', 500);
        }

        $key = hash('sha256', $keyMaterial, true);
        $algorithm = strtolower(trim((string)($payload['alg'] ?? $payload['algoritmo'] ?? '')));

        if ($algorithm === '' && isset($payload['nonce'], $payload['cipher'])) {
            $algorithm = 'sodium-secretbox';
        }
        if ($algorithm === '' && isset($payload['iv'], $payload['tag'], $payload['cipher'])) {
            $algorithm = 'openssl-aes-256-gcm';
        }

        if ($algorithm === 'openssl-aes-256-gcm') {
            if (!function_exists('openssl_decrypt')) {
                throw new RuntimeException('No hay soporte OpenSSL para descifrar credenciales', 500);
            }

            $iv = base64_decode((string)($payload['iv'] ?? ''), true);
            $tag = base64_decode((string)($payload['tag'] ?? ''), true);
            $cipher = base64_decode((string)($payload['cipher'] ?? ''), true);
            if ($iv === false || $tag === false || $cipher === false) {
                throw new RuntimeException('La credencial almacenada tiene formato inválido', 500);
            }

            $plain = openssl_decrypt($cipher, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
            if ($plain === false) {
                throw new RuntimeException('No fue posible descifrar la credencial', 500);
            }

            return $plain;
        }

        $nonce = base64_decode((string)($payload['nonce'] ?? ''), true);
        $cipher = base64_decode((string)($payload['cipher'] ?? ''), true);
        if ($nonce === false || $cipher === false) {
            throw new RuntimeException('La credencial almacenada tiene formato inválido', 500);
        }

        if (!function_exists('sodium_crypto_secretbox_open')) {
            throw new RuntimeException('No hay soporte libsodium para descifrar credenciales', 500);
        }

        $plain = sodium_crypto_secretbox_open($cipher, $nonce, $key);
        if ($plain === false) {
            throw new RuntimeException('No fue posible descifrar la credencial', 500);
        }

        return $plain;
    }
    private function guardarEquipo(array $payload, array $body, ?int $equipoId = null): array
    {
        $this->assertModuleAccess($payload);
        $userId = $this->currentUserIdOrFail($payload);
        $userName = $this->currentUserName($payload);
        $equipo = $this->arrayOrEmpty($body['equipo'] ?? $body);
        $hardware = $this->arrayOrEmpty($body['hardware'] ?? []);
        $seguridad = $this->arrayOrEmpty($body['seguridad'] ?? []);
        $credencial = $this->arrayOrEmpty($body['credencial'] ?? []);

        $codigo = $this->normalizeText($equipo['codigo_equipo'] ?? $equipo['codigo'] ?? '');
        if ($codigo === '') {
            throw new RuntimeException('El cÃƒÆ’Ã‚Â³digo del equipo es requerido', 400);
        }

        $data = [
            'tipo_equipo' => $this->normalizeText($equipo['tipo_equipo'] ?? ''),
            'area' => $this->normalizeText($equipo['area'] ?? ''),
            'usuario_asignado' => $this->normalizeText($equipo['usuario_asignado'] ?? ''),
            'rol_equipo' => $this->normalizeText($equipo['rol_equipo'] ?? ''),
            'ip_actual' => $this->normalizeText($equipo['ip_actual'] ?? ''),
            'estado' => strtoupper($this->normalizeText($equipo['estado'] ?? 'ACTIVO')),
            'fecha_alta' => $this->normalizeDate($equipo['fecha_alta'] ?? null),
            'fecha_baja' => $this->normalizeDate($equipo['fecha_baja'] ?? null),
            'licencias' => $this->normalizeText($equipo['licencias'] ?? ''),
            'accesos_ip' => $this->normalizeText($equipo['accesos_ip'] ?? ''),
            'observaciones' => $this->normalizeText($equipo['observaciones'] ?? ''),
        ];

        if (!in_array($data['estado'], self::EQUIPO_ESTADOS, true)) {
            $data['estado'] = 'ACTIVO';
        }

        if ($equipoId === null) {
            $this->db->execute(
                'INSERT INTO ti_equipo
                 (codigo_equipo, tipo_equipo, area, usuario_asignado, rol_equipo, ip_actual, estado, fecha_alta, fecha_baja, licencias, accesos_ip, observaciones, creado_por, actualizado_por)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    $codigo,
                    $data['tipo_equipo'],
                    $data['area'],
                    $data['usuario_asignado'],
                    $data['rol_equipo'],
                    $data['ip_actual'],
                    $data['estado'],
                    $data['fecha_alta'],
                    $data['fecha_baja'],
                    $data['licencias'] ?: null,
                    $data['accesos_ip'] ?: null,
                    $data['observaciones'] ?: null,
                    $userId,
                    $userId,
                ]
            );
            $equipoId = (int)$this->db->mysql()->lastInsertId();
            $this->db->execute(
                'INSERT INTO ti_equipo_historial (equipo_id, tipo_evento, campo, valor_anterior, valor_nuevo, descripcion, usuario_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)',
                [$equipoId, 'CREACION', 'equipo', null, null, 'Equipo creado desde Soporte TI', $userId]
            );
        } else {
            $anterior = $this->db->fetchOne('SELECT * FROM ti_equipo WHERE id = ? LIMIT 1', [$equipoId]);
            if (!$anterior) {
                throw new RuntimeException('Equipo no encontrado', 404);
            }

            $this->db->execute(
                'UPDATE ti_equipo
                 SET codigo_equipo = ?,
                     tipo_equipo = ?,
                     area = ?,
                     usuario_asignado = ?,
                     rol_equipo = ?,
                     ip_actual = ?,
                     estado = ?,
                     fecha_alta = ?,
                     fecha_baja = ?,
                     licencias = ?,
                     accesos_ip = ?,
                     observaciones = ?,
                     actualizado_por = ?,
                     actualizado_en = NOW()
                 WHERE id = ?',
                [
                    $codigo,
                    $data['tipo_equipo'],
                    $data['area'],
                    $data['usuario_asignado'],
                    $data['rol_equipo'],
                    $data['ip_actual'],
                    $data['estado'],
                    $data['fecha_alta'],
                    $data['fecha_baja'],
                    $data['licencias'] ?: null,
                    $data['accesos_ip'] ?: null,
                    $data['observaciones'] ?: null,
                    $userId,
                    $equipoId,
                ]
            );

            $cambios = [];
            foreach ([
                'codigo_equipo' => $codigo,
                'tipo_equipo' => $data['tipo_equipo'],
                'area' => $data['area'],
                'usuario_asignado' => $data['usuario_asignado'],
                'rol_equipo' => $data['rol_equipo'],
                'ip_actual' => $data['ip_actual'],
                'estado' => $data['estado'],
                'fecha_alta' => $data['fecha_alta'],
                'fecha_baja' => $data['fecha_baja'],
            ] as $field => $value) {
                $old = $this->normalizeText($anterior[$field] ?? '');
                $new = $this->normalizeText($value ?? '');
                if ($old !== $new) {
                    $cambios[] = $field . ': ' . $old . ' -> ' . $new;
                }
            }

            if ($cambios) {
                $this->db->execute(
                    'INSERT INTO ti_equipo_historial (equipo_id, tipo_evento, campo, valor_anterior, valor_nuevo, descripcion, usuario_id)
                     VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [$equipoId, 'ACTUALIZACION', 'equipo', null, null, implode('; ', $cambios), $userId]
                );
            }
        }

        $this->db->execute(
            'INSERT INTO ti_equipo_hardware
             (equipo_id, generacion_procesador, descripcion_procesador, ram_gb, generacion_ram, tipo_equipo_fisico, almacenamiento_principal, almacenamiento_secundario, estado_disco, placa_madre, red, wifi, sistema_operativo, licencia_so)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               generacion_procesador = VALUES(generacion_procesador),
               descripcion_procesador = VALUES(descripcion_procesador),
               ram_gb = VALUES(ram_gb),
               generacion_ram = VALUES(generacion_ram),
               tipo_equipo_fisico = VALUES(tipo_equipo_fisico),
               almacenamiento_principal = VALUES(almacenamiento_principal),
               almacenamiento_secundario = VALUES(almacenamiento_secundario),
               estado_disco = VALUES(estado_disco),
               placa_madre = VALUES(placa_madre),
               red = VALUES(red),
               wifi = VALUES(wifi),
               sistema_operativo = VALUES(sistema_operativo),
               licencia_so = VALUES(licencia_so),
               actualizado_en = NOW()',
            [
                $equipoId,
                $this->normalizeText($hardware['generacion_procesador'] ?? ''),
                $this->normalizeText($hardware['descripcion_procesador'] ?? ''),
                $this->normalizeFloat($hardware['ram_gb'] ?? null),
                $this->normalizeText($hardware['generacion_ram'] ?? ''),
                $this->normalizeText($hardware['tipo_equipo_fisico'] ?? ''),
                $this->normalizeText($hardware['almacenamiento_principal'] ?? ''),
                $this->normalizeText($hardware['almacenamiento_secundario'] ?? ''),
                $this->normalizeText($hardware['estado_disco'] ?? ''),
                $this->normalizeText($hardware['placa_madre'] ?? ''),
                $this->normalizeText($hardware['red'] ?? ''),
                $this->normalizeText($hardware['wifi'] ?? ''),
                $this->normalizeText($hardware['sistema_operativo'] ?? ''),
                $this->normalizeText($hardware['licencia'] ?? ''),
            ]
        );

        $this->db->execute(
            'INSERT INTO ti_equipo_seguridad
             (equipo_id, tipo_cuenta, antivirus, antivirus_activo, firewall_activo, ultima_actualizacion_so, estado_seguridad, observaciones)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               tipo_cuenta = VALUES(tipo_cuenta),
               antivirus = VALUES(antivirus),
               antivirus_activo = VALUES(antivirus_activo),
               firewall_activo = VALUES(firewall_activo),
               ultima_actualizacion_so = VALUES(ultima_actualizacion_so),
               estado_seguridad = VALUES(estado_seguridad),
               observaciones = VALUES(observaciones),
               actualizado_en = NOW()',
            [
                $equipoId,
                $this->normalizeText($seguridad['tipo_cuenta'] ?? ''),
                $this->normalizeText($seguridad['antivirus'] ?? ''),
                $this->normalizeBool($seguridad['antivirus_activo'] ?? null),
                $this->normalizeBool($seguridad['firewall'] ?? null),
                $this->normalizeDate($seguridad['ultima_actualizacion_so'] ?? null),
                $this->normalizeText($seguridad['estado_seguridad'] ?? ''),
                $this->normalizeText($seguridad['observaciones'] ?? ''),
            ]
        );

        if (array_key_exists('secreto', $credencial) || array_key_exists('credencial', $credencial)) {
            $secreto = $this->normalizeText($credencial['secreto'] ?? $credencial['credencial'] ?? '');
            if ($secreto !== '') {
                $valorCifrado = $this->encryptCredential($secreto);
                $descripcion = $this->normalizeText($credencial['descripcion'] ?? '');
                $this->db->execute(
                    'INSERT INTO ti_equipo_credencial (equipo_id, tipo, usuario, valor_cifrado, descripcion, activo, creado_por, actualizado_por)
                     VALUES (?, ?, ?, ?, ?, 1, ?, ?)
                     ON DUPLICATE KEY UPDATE
                       tipo = VALUES(tipo),
                       usuario = VALUES(usuario),
                       valor_cifrado = VALUES(valor_cifrado),
                       descripcion = VALUES(descripcion),
                       activo = VALUES(activo),
                       actualizado_por = VALUES(actualizado_por),
                       actualizado_en = NOW()',
                    [$equipoId, 'LOCAL', $userName, $valorCifrado, $descripcion, $userId, $userId]
                );
            }
        }

        $this->db->execute(
            'INSERT INTO ti_equipo_historial (equipo_id, tipo_evento, campo, valor_anterior, valor_nuevo, descripcion, usuario_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$equipoId, 'SINCRONIZACION', 'equipo', null, null, 'Hardware y seguridad actualizados', $userId]
        );

        return $this->verEquipo($payload, $equipoId);
    }

    private function listarActividades(array $payload, array $query): array
    {
        $this->assertModuleAccess($payload);
        $estado = $this->normalizeText($query['estado'] ?? '');
        $prioridad = $this->normalizeText($query['prioridad'] ?? '');
        $search = $this->normalizeText($query['search'] ?? $query['q'] ?? '');

        $where = [];
        $params = [];
        if ($estado !== '') {
            $where[] = 'a.estado = ?';
            $params[] = strtoupper($estado);
        }
        if ($prioridad !== '') {
            $where[] = 'a.prioridad = ?';
            $params[] = strtoupper($prioridad);
        }
        if ($search !== '') {
            $where[] = '(a.numero LIKE ? OR a.titulo LIKE ? OR a.solicitante LIKE ? OR u.nombre LIKE ? OR u.codigo LIKE ?)';
            $params[] = '%' . $search . '%';
            $params[] = '%' . $search . '%';
            $params[] = '%' . $search . '%';
            $params[] = '%' . $search . '%';
            $params[] = '%' . $search . '%';
        }

        $sql = "SELECT
                    a.id,
                    a.numero,
                    a.titulo,
                    a.descripcion,
                    a.solicitante,
                    a.area,
                    a.tipo,
                    a.prioridad,
                    a.estado,
                    a.fecha_solicitud,
                    a.fecha_objetivo,
                    a.fecha_inicio,
                    a.fecha_cierre,
                    a.responsable_usuario_id,
                    u.nombre AS responsable_nombre,
                    a.equipo_id,
                    e.codigo_equipo AS equipo_codigo,
                    COALESCE(SUM(CASE WHEN h.tipo_evento = 'COMENTARIO' THEN 1 ELSE 0 END), 0) AS comentarios
                 FROM ti_actividad a
                 LEFT JOIN ti_equipo e ON e.id = a.equipo_id
                 LEFT JOIN usuario u ON u.id = a.responsable_usuario_id
                 LEFT JOIN ti_actividad_historial h ON h.actividad_id = a.id";
        if ($where) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }
        $sql .= ' GROUP BY a.id
                  ORDER BY
                    CASE WHEN a.estado = "PENDIENTE" THEN 1 WHEN a.estado = "EN_PROCESO" THEN 2 WHEN a.estado = "EN_ESPERA" THEN 3 WHEN a.estado = "FINALIZADA" THEN 4 ELSE 5 END,
                    a.creado_en DESC,
                    a.id DESC';

        $rows = $this->db->fetchAll($sql, $params);
        $items = array_map(fn (array $row) => $this->actividadToViewRow($row), $rows);

        return [
            'ok' => true,
            'actividades' => $items,
            'filtros' => [
                'estado' => $estado,
                'prioridad' => $prioridad,
                'search' => $search,
            ],
        ];
    }

    private function actividadToViewRow(array $row): array
    {
        $fechaObjetivo = $this->normalizeText($row['fecha_objetivo'] ?? '');
        $estado = $this->normalizeText($row['estado'] ?? '');
        $vencida = false;
        if ($fechaObjetivo !== '' && !in_array($estado, ['FINALIZADA', 'CANCELADA'], true)) {
            try {
                $vencida = new DateTimeImmutable($fechaObjetivo) < new DateTimeImmutable('now');
            } catch (Throwable) {
                $vencida = false;
            }
        }

        return [
            'id' => (int)($row['id'] ?? 0),
            'numero' => $this->normalizeText($row['numero'] ?? ''),
            'titulo' => $this->normalizeText($row['titulo'] ?? ''),
            'descripcion' => $this->normalizeText($row['descripcion'] ?? ''),
            'solicitante' => $this->normalizeText($row['solicitante'] ?? ''),
            'area' => $this->normalizeText($row['area'] ?? ''),
            'tipo' => $this->normalizeText($row['tipo'] ?? ''),
            'prioridad' => $this->normalizeText($row['prioridad'] ?? ''),
            'estado' => $estado,
            'fecha_solicitud' => $this->normalizeText($row['fecha_solicitud'] ?? ''),
            'fecha_objetivo' => $fechaObjetivo,
            'fecha_inicio' => $this->normalizeText($row['fecha_inicio'] ?? ''),
            'fecha_cierre' => $this->normalizeText($row['fecha_cierre'] ?? ''),
            'responsable_nombre' => $this->normalizeText($row['responsable_nombre'] ?? ''),
            'responsable_usuario_id' => isset($row['responsable_usuario_id']) ? (int)$row['responsable_usuario_id'] : null,
            'equipo_id' => isset($row['equipo_id']) ? (int)$row['equipo_id'] : null,
            'equipo_codigo' => $this->normalizeText($row['equipo_codigo'] ?? ''),
            'comentarios' => isset($row['comentarios']) ? (int)$row['comentarios'] : 0,
            'vencida' => $vencida,
        ];
    }

    private function verActividad(int $actividadId): array
    {
        $actividad = $this->db->fetchOne(
            'SELECT
                a.id,
                a.numero,
                a.titulo,
                a.descripcion,
                a.solicitante,
                a.area,
                a.tipo,
                a.prioridad,
                a.estado,
                a.fecha_solicitud,
                a.fecha_objetivo,
                a.fecha_inicio,
                a.fecha_cierre,
                a.responsable_usuario_id,
                a.equipo_id,
                a.creado_por,
                a.creado_en,
                a.actualizado_en,
                u.nombre AS responsable_nombre,
                e.codigo_equipo AS equipo_codigo
             FROM ti_actividad a
             LEFT JOIN usuario u ON u.id = a.responsable_usuario_id
             LEFT JOIN ti_equipo e ON e.id = a.equipo_id
             WHERE a.id = ?
             LIMIT 1',
            [$actividadId]
        );
        if (!$actividad) {
            throw new RuntimeException('Actividad no encontrada', 404);
        }

        $comentarios = $this->db->fetchAll(
            'SELECT h.id, h.tipo_evento, h.comentario, h.usuario_id, u.nombre AS usuario_nombre, h.creado_en AS created_at
             FROM ti_actividad_historial h
             LEFT JOIN usuario u ON u.id = h.usuario_id
             WHERE h.actividad_id = ?
               AND h.tipo_evento = "COMENTARIO"
             ORDER BY h.creado_en DESC, h.id DESC',
            [$actividadId]
        );
        $historial = $this->db->fetchAll(
            'SELECT h.id, h.tipo_evento AS accion, h.comentario AS detalle, h.usuario_id, u.nombre AS usuario_nombre, h.creado_en AS created_at
             FROM ti_actividad_historial h
             LEFT JOIN usuario u ON u.id = h.usuario_id
             WHERE h.actividad_id = ?
             ORDER BY h.creado_en DESC, h.id DESC',
            [$actividadId]
        );

        return [
            'ok' => true,
            'actividad' => $this->actividadToViewRow($actividad),
            'comentarios' => array_map(static fn (array $row): array => [
                'id' => (int)($row['id'] ?? 0),
                'comentario' => trim((string)($row['comentario'] ?? '')),
                'usuario_id' => isset($row['usuario_id']) ? (int)$row['usuario_id'] : null,
                'usuario_nombre' => trim((string)($row['usuario_nombre'] ?? '')),
                'created_at' => trim((string)($row['created_at'] ?? '')),
            ], $comentarios),
            'historial' => array_map(static fn (array $row): array => [
                'id' => (int)($row['id'] ?? 0),
                'accion' => trim((string)($row['accion'] ?? '')),
                'detalle' => trim((string)($row['detalle'] ?? '')),
                'usuario_id' => isset($row['usuario_id']) ? (int)$row['usuario_id'] : null,
                'usuario_nombre' => trim((string)($row['usuario_nombre'] ?? '')),
                'created_at' => trim((string)($row['created_at'] ?? '')),
            ], $historial),
        ];
    }

    private function listarResponsables(array $payload): array
    {
        $this->assertModuleAccess($payload);
        $rows = $this->db->fetchAll(
            'SELECT id, nombre, codigo, area
             FROM usuario
             WHERE is_active = 1
             ORDER BY nombre ASC, id ASC'
        );

        return [
            'ok' => true,
            'responsables' => array_map(static function (array $row): array {
                return [
                    'id' => (int)($row['id'] ?? 0),
                    'nombre' => trim((string)($row['nombre'] ?? '')),
                    'codigo' => trim((string)($row['codigo'] ?? '')),
                    'area' => trim((string)($row['area'] ?? '')),
                ];
            }, $rows),
        ];
    }

    private function guardarActividad(array $payload, array $body, ?int $actividadId = null): array
    {
        $this->assertModuleAccess($payload);
        $userId = $this->currentUserIdOrFail($payload);
        $userName = $this->currentUserName($payload);
        $actividad = $this->arrayOrEmpty($body['actividad'] ?? $body);

        $titulo = $this->normalizeText($actividad['titulo'] ?? '');
        if ($titulo === '') {
            throw new RuntimeException('El tÃƒÆ’Ã‚Â­tulo es requerido', 400);
        }

        $estado = strtoupper($this->normalizeText($actividad['estado'] ?? 'PENDIENTE'));
        if (!in_array($estado, self::ACTIVIDAD_ESTADOS, true)) {
            $estado = 'PENDIENTE';
        }

        $prioridad = strtoupper($this->normalizeText($actividad['prioridad'] ?? 'MEDIA'));
        if (!in_array($prioridad, self::ACTIVIDAD_PRIORIDADES, true)) {
            $prioridad = 'MEDIA';
        }

        $equipoId = $this->resolveEquipoId($actividad['equipo_id'] ?? $actividad['equipoId'] ?? null);
        $responsableUsuarioId = $this->resolveResponsableUsuarioId(
            $actividad['responsable_usuario_id'] ?? $actividad['responsableUsuarioId'] ?? $actividad['responsable'] ?? $actividad['responsable_nombre'] ?? null
        );
        $solicitante = $this->normalizeText($actividad['solicitante'] ?? $actividad['solicitante_nombre'] ?? $userName);
        $area = $this->normalizeText($actividad['area'] ?? $actividad['solicitante_area'] ?? '');

        $fechaSolicitud = $this->normalizeDateTime($actividad['fecha_solicitud'] ?? $actividad['fechaSolicitud'] ?? 'now') ?? (new DateTimeImmutable('now'))->format('Y-m-d H:i:s');
        $fechaObjetivo = $this->normalizeDateTime($actividad['fecha_objetivo'] ?? $actividad['fechaObjetivo'] ?? null);
        $fechaInicio = $this->normalizeDateTime($actividad['fecha_inicio'] ?? $actividad['fechaInicio'] ?? null);
        $fechaCierre = $this->normalizeDateTime($actividad['fecha_cierre'] ?? $actividad['fechaCierre'] ?? null);
        $numeroTemporal = sprintf('TMP-%s-%04d', (new DateTimeImmutable('now'))->format('YmdHis'), random_int(0, 9999));

        if ($actividadId === null) {
            $this->db->execute(
                'INSERT INTO ti_actividad
                 (numero, titulo, descripcion, solicitante, area, tipo, prioridad, estado, fecha_solicitud, fecha_objetivo, fecha_inicio, fecha_cierre, responsable_usuario_id, equipo_id, creado_por)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    $numeroTemporal,
                    $titulo,
                    $this->normalizeText($actividad['descripcion'] ?? ''),
                    $solicitante,
                    $area,
                    $this->normalizeText($actividad['tipo'] ?? ''),
                    $prioridad,
                    $estado,
                    $fechaSolicitud,
                    $fechaObjetivo,
                    $fechaInicio,
                    $fechaCierre,
                    $responsableUsuarioId,
                    $equipoId,
                    $userId,
                ]
            );
            $actividadId = (int)$this->db->mysql()->lastInsertId();
            $numero = sprintf('TI-%s-%06d', (new DateTimeImmutable($fechaSolicitud))->format('Y'), $actividadId);
            $this->db->execute('UPDATE ti_actividad SET numero = ? WHERE id = ?', [$numero, $actividadId]);
            $this->db->execute(
                'INSERT INTO ti_actividad_historial (actividad_id, tipo_evento, estado_anterior, estado_nuevo, comentario, usuario_id)
                 VALUES (?, ?, ?, ?, ?, ?)',
                [$actividadId, 'CREACION', null, $estado, 'Actividad creada desde Soporte TI', $userId]
            );
        } else {
            $actual = $this->db->fetchOne('SELECT * FROM ti_actividad WHERE id = ? LIMIT 1', [$actividadId]);
            if (!$actual) {
                throw new RuntimeException('Actividad no encontrada', 404);
            }

            $this->db->execute(
                'UPDATE ti_actividad
                 SET titulo = ?,
                     descripcion = ?,
                     solicitante = ?,
                     area = ?,
                     tipo = ?,
                     prioridad = ?,
                     estado = ?,
                     fecha_solicitud = ?,
                     fecha_objetivo = ?,
                     fecha_inicio = ?,
                    fecha_cierre = ?,
                    responsable_usuario_id = ?,
                    equipo_id = ?,
                    actualizado_en = NOW()
                 WHERE id = ?',
                [
                    $titulo,
                    $this->normalizeText($actividad['descripcion'] ?? ''),
                    $solicitante,
                    $area,
                    $this->normalizeText($actividad['tipo'] ?? ''),
                    $prioridad,
                    $estado,
                    $fechaSolicitud,
                    $fechaObjetivo,
                    $fechaInicio,
                    $fechaCierre,
                    $responsableUsuarioId,
                    $equipoId,
                    $actividadId,
                ]
            );

            $changes = [];
            foreach ([
                'titulo' => $titulo,
                'prioridad' => $prioridad,
                'estado' => $estado,
                'responsable_usuario_id' => $responsableUsuarioId,
                'equipo_id' => $equipoId,
            ] as $field => $newValue) {
                $oldValue = $actual[$field] ?? null;
                if ((string)$oldValue !== (string)$newValue) {
                    $changes[] = $field . ': ' . (string)$oldValue . ' -> ' . (string)$newValue;
                }
            }
            if ($changes) {
                $this->db->execute(
                    'INSERT INTO ti_actividad_historial (actividad_id, tipo_evento, estado_anterior, estado_nuevo, comentario, usuario_id)
                     VALUES (?, ?, ?, ?, ?, ?)',
                    [$actividadId, 'ACTUALIZACION', null, null, implode('; ', $changes), $userId]
                );
            }
        }

        return $this->verActividad($actividadId);
    }

    private function cambiarEstadoActividad(array $payload, int $actividadId, array $body): array
    {
        $this->assertModuleAccess($payload);
        $estado = strtoupper($this->normalizeText($body['estado'] ?? ''));
        if (!in_array($estado, self::ACTIVIDAD_ESTADOS, true)) {
            throw new RuntimeException('Estado invÃƒÆ’Ã‚Â¡lido', 400);
        }

        $actividad = $this->db->fetchOne('SELECT * FROM ti_actividad WHERE id = ? LIMIT 1', [$actividadId]);
        if (!$actividad) {
            throw new RuntimeException('Actividad no encontrada', 404);
        }

        $fechaInicio = $this->normalizeDateTime($body['fecha_inicio'] ?? null);
        $fechaCierre = $this->normalizeDateTime($body['fecha_cierre'] ?? null);

        if ($estado === 'EN_PROCESO' && $fechaInicio === null) {
            $fechaInicio = (new DateTimeImmutable('now'))->format('Y-m-d H:i:s');
        }
        if ($estado === 'FINALIZADA' && $fechaCierre === null) {
            $fechaCierre = (new DateTimeImmutable('now'))->format('Y-m-d H:i:s');
        }

        $this->db->execute(
            'UPDATE ti_actividad
             SET estado = ?,
                 fecha_inicio = COALESCE(?, fecha_inicio),
                 fecha_cierre = COALESCE(?, fecha_cierre),
                 actualizado_en = NOW()
             WHERE id = ?',
            [$estado, $fechaInicio, $fechaCierre, $actividadId]
        );

        $this->db->execute(
            'INSERT INTO ti_actividad_historial (actividad_id, tipo_evento, estado_anterior, estado_nuevo, comentario, usuario_id)
             VALUES (?, ?, ?, ?, ?, ?)',
            [$actividadId, 'CAMBIO_ESTADO', null, $estado, 'Estado actualizado a ' . $estado, $this->currentUserIdOrFail($payload)]
        );

        return $this->verActividad($actividadId);
    }

    private function agregarComentarioActividad(array $payload, int $actividadId, array $body): array
    {
        $this->assertModuleAccess($payload);
        $comentario = $this->normalizeText($body['comentario'] ?? '');
        if ($comentario === '') {
            throw new RuntimeException('El comentario es requerido', 400);
        }

        $actividad = $this->db->fetchOne('SELECT id FROM ti_actividad WHERE id = ? LIMIT 1', [$actividadId]);
        if (!$actividad) {
            throw new RuntimeException('Actividad no encontrada', 404);
        }

        $userId = $this->currentUserIdOrFail($payload);
        $userName = $this->currentUserName($payload);
        $this->db->execute(
            'INSERT INTO ti_actividad_historial (actividad_id, tipo_evento, estado_anterior, estado_nuevo, comentario, usuario_id)
             VALUES (?, ?, ?, ?, ?, ?)',
            [$actividadId, 'COMENTARIO', null, null, $comentario, $userId]
        );

        return $this->verActividad($actividadId);
    }

    private function listarMantenciones(array $payload, array $query): array
    {
        $this->assertModuleAccess($payload);
        $equipoId = isset($query['equipo_id']) ? (int)$query['equipo_id'] : 0;
        $where = [];
        $params = [];
        if ($equipoId > 0) {
            $where[] = 'm.equipo_id = ?';
            $params[] = $equipoId;
        }

        $sql = 'SELECT
                    m.id,
                    m.equipo_id,
                    e.codigo_equipo,
                    e.tipo_equipo,
                    m.tipo_mantencion,
                    m.motivo,
                    m.fecha_inicio,
                    m.fecha_mantencion,
                    m.tecnico_responsable,
                    m.so_reinstalado,
                    m.drivers_ok,
                    m.disco_revisado,
                    m.resultado_ok AS resultado,
                    m.mantencion_realizada AS mantencion,
                    m.observaciones
                FROM ti_mantencion m
                INNER JOIN ti_equipo e ON e.id = m.equipo_id';
        if ($where) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }
        $sql .= ' ORDER BY COALESCE(m.fecha_mantencion, m.creado_en) DESC, m.id DESC';

        $rows = $this->db->fetchAll($sql, $params);
        $items = array_map(function (array $row): array {
            return [
                'id' => (int)($row['id'] ?? 0),
                'equipo_id' => isset($row['equipo_id']) ? (int)$row['equipo_id'] : null,
                'codigo_equipo' => trim((string)($row['codigo_equipo'] ?? '')),
                'tipo_equipo' => trim((string)($row['tipo_equipo'] ?? '')),
                'tipo_mantencion' => trim((string)($row['tipo_mantencion'] ?? '')),
                'motivo' => trim((string)($row['motivo'] ?? '')),
                'fecha_inicio' => trim((string)($row['fecha_inicio'] ?? '')),
                'fecha_mantencion' => trim((string)($row['fecha_mantencion'] ?? '')),
                'tecnico_responsable' => trim((string)($row['tecnico_responsable'] ?? '')),
                'so_reinstalado' => $row['so_reinstalado'] === null ? null : (int)$row['so_reinstalado'],
                'drivers_ok' => $row['drivers_ok'] === null ? null : (int)$row['drivers_ok'],
                'disco_revisado' => $row['disco_revisado'] === null ? null : (int)$row['disco_revisado'],
                'resultado' => $this->mantencionEstadoLabel($row['resultado'] ?? null),
                'mantencion' => $row['mantencion'] === null ? null : (int)$row['mantencion'],
                'observaciones' => trim((string)($row['observaciones'] ?? '')),
            ];
        }, $rows);

        return ['ok' => true, 'mantenciones' => $items];
    }

    private function verMantencion(array $payload, int $mantencionId): array
    {
        $this->assertModuleAccess($payload);
        $mantencion = $this->db->fetchOne(
            'SELECT m.id, m.equipo_id, e.codigo_equipo, e.tipo_equipo, m.tipo_mantencion, m.motivo, m.fecha_inicio, m.fecha_mantencion, m.tecnico_responsable, m.so_reinstalado, m.drivers_ok, m.disco_revisado, m.resultado_ok AS resultado, m.mantencion_realizada AS mantencion, m.observaciones
             FROM ti_mantencion m
             INNER JOIN ti_equipo e ON e.id = m.equipo_id
             WHERE m.id = ?',
            [$mantencionId]
        );

        if (!$mantencion) {
            throw new RuntimeException('La mantención no existe', 404);
        }

        return [
            'ok' => true,
            'mantencion' => $this->mantencionRowToView($mantencion),
        ];
    }

    private function mantencionRowToView(array $row): array
    {
        return [
            'id' => (int)($row['id'] ?? 0),
            'equipo_id' => isset($row['equipo_id']) ? (int)$row['equipo_id'] : null,
            'codigo_equipo' => trim((string)($row['codigo_equipo'] ?? '')),
            'tipo_equipo' => trim((string)($row['tipo_equipo'] ?? '')),
            'tipo_mantencion' => trim((string)($row['tipo_mantencion'] ?? '')),
            'motivo' => trim((string)($row['motivo'] ?? '')),
            'fecha_inicio' => trim((string)($row['fecha_inicio'] ?? '')),
            'fecha_mantencion' => trim((string)($row['fecha_mantencion'] ?? '')),
            'tecnico_responsable' => trim((string)($row['tecnico_responsable'] ?? '')),
            'so_reinstalado' => $row['so_reinstalado'] === null ? null : (int)$row['so_reinstalado'],
            'drivers_ok' => $row['drivers_ok'] === null ? null : (int)$row['drivers_ok'],
            'disco_revisado' => $row['disco_revisado'] === null ? null : (int)$row['disco_revisado'],
            'resultado' => $this->mantencionEstadoLabel($row['resultado'] ?? null),
            'mantencion' => $row['mantencion'] === null ? null : (int)$row['mantencion'],
            'observaciones' => trim((string)($row['observaciones'] ?? '')),
        ];
    }

    private function normalizeMantencionResultadoOk(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        $text = strtoupper(trim($this->normalizeText($value)));
        $text = preg_replace('/\s+/', ' ', $text) ?? $text;

        return match ($text) {
            'COMPLETADA', 'COMPLETADO', 'REALIZADA', 'REALIZADO', 'HECHA', 'HECHO', 'FINALIZADA', 'FINALIZADO' => 1,
            'PENDIENTE', 'REQUIERE SEGUIMIENTO', 'REQUIERE_SEGUIMIENTO', 'NO RESUELTA', 'NO RESUELTO' => 0,
            default => is_numeric($value) ? ((int)$value !== 0 ? 1 : 0) : null,
        };
    }

    private function guardarMantencion(array $payload, array $body, ?int $mantencionId = null): array
    {
        $this->assertModuleAccess($payload);
        $userId = $this->currentUserIdOrFail($payload);
        $userName = $this->currentUserName($payload);
        $mantencion = $this->arrayOrEmpty($body['mantencion'] ?? $body);

        $equipoId = $this->resolveEquipoId($mantencion['equipo_id'] ?? $mantencion['equipoId'] ?? null);
        if (!$equipoId) {
            throw new RuntimeException('El equipo es requerido', 400);
        }

        $tipo = $this->normalizeText($mantencion['tipo_mantencion'] ?? '');
        if ($tipo === '') {
            throw new RuntimeException('El tipo de mantenciÃƒÆ’Ã‚Â³n es requerido', 400);
        }

        $data = [
            'motivo' => $this->normalizeText($mantencion['motivo'] ?? ''),
            'fecha_inicio' => $this->normalizeDate($mantencion['fecha_inicio'] ?? null),
            'fecha_mantencion' => $this->normalizeDate($mantencion['fecha_mantencion'] ?? null),
            'tecnico_responsable' => $this->normalizeText($mantencion['tecnico_responsable'] ?? ''),
            'so_reinstalado' => $this->normalizeBool($mantencion['so_reinstalado'] ?? null),
            'drivers_ok' => $this->normalizeBool($mantencion['drivers_ok'] ?? null),
            'disco_revisado' => $this->normalizeBool($mantencion['disco_revisado'] ?? null),
            'resultado' => $this->normalizeMantencionResultadoOk($mantencion['resultado'] ?? null),
            'mantencion' => $this->normalizeBool($mantencion['mantencion'] ?? null),
            'observaciones' => $this->normalizeText($mantencion['observaciones'] ?? ''),
        ];

        if ($mantencionId === null) {
            $this->db->execute(
                'INSERT INTO ti_mantencion
                 (equipo_id, tipo_mantencion, motivo, fecha_inicio, fecha_mantencion, tecnico_responsable, so_reinstalado, drivers_ok, disco_revisado, resultado_ok, mantencion_realizada, observaciones, usuario_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    $equipoId,
                    $tipo,
                    $data['motivo'] ?: null,
                    $data['fecha_inicio'],
                    $data['fecha_mantencion'],
                    $data['tecnico_responsable'] ?: null,
                    $data['so_reinstalado'],
                    $data['drivers_ok'],
                    $data['disco_revisado'],
                    $data['resultado'],
                    $data['mantencion'],
                    $data['observaciones'] ?: null,
                    $userId,
                ]
            );
            $mantencionId = (int)$this->db->mysql()->lastInsertId();
            $this->db->execute(
                'INSERT INTO ti_equipo_historial (equipo_id, tipo_evento, campo, valor_anterior, valor_nuevo, descripcion, usuario_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)',
                [$equipoId, 'MANTENCION', 'mantenimiento', null, null, 'Se registrÃƒÆ’Ã‚Â³ una mantenciÃƒÆ’Ã‚Â³n TI', $userId]
            );
        } else {
            $affected = $this->db->execute(
                'UPDATE ti_mantencion
                 SET tipo_mantencion = ?,
                     motivo = ?,
                     fecha_inicio = ?,
                     fecha_mantencion = ?,
                     tecnico_responsable = ?,
                     so_reinstalado = ?,
                     drivers_ok = ?,
                     disco_revisado = ?,
                     resultado_ok = ?,
                     mantencion_realizada = ?,
                     observaciones = ?,
                     usuario_id = ?,
                     actualizado_en = NOW()
                 WHERE id = ?',
                [
                    $tipo,
                    $data['motivo'] ?: null,
                    $data['fecha_inicio'],
                    $data['fecha_mantencion'],
                    $data['tecnico_responsable'] ?: null,
                    $data['so_reinstalado'],
                    $data['drivers_ok'],
                    $data['disco_revisado'],
                    $data['resultado'],
                    $data['mantencion'],
                    $data['observaciones'] ?: null,
                    $userId,
                    $mantencionId,
                ]
            );

            if ($affected === 0) {
                $exists = $this->db->fetchOne('SELECT id FROM ti_mantencion WHERE id = ?', [$mantencionId]);
                if (!$exists) {
                    throw new RuntimeException('No se encontró la mantención', 404);
                }

                throw new RuntimeException('No se encontró la mantención o no hubo cambios.', 409);
            }
        }

        $viewRow = $this->db->fetchOne(
            'SELECT m.id, m.equipo_id, e.codigo_equipo, e.tipo_equipo, m.tipo_mantencion, m.motivo, m.fecha_inicio, m.fecha_mantencion, m.tecnico_responsable, m.so_reinstalado, m.drivers_ok, m.disco_revisado, m.resultado_ok AS resultado, m.mantencion_realizada AS mantencion, m.observaciones
             FROM ti_mantencion m
             INNER JOIN ti_equipo e ON e.id = m.equipo_id
             WHERE m.id = ?',
            [$mantencionId]
        );

        if (!$viewRow) {
            throw new RuntimeException('No se encontró la mantención actualizada', 404);
        }

        return [
            'ok' => true,
            'id' => $mantencionId,
            'mantencion' => $this->mantencionRowToView($viewRow),
        ];
    }

    private function listarProductosBodega(array $payload, array $query): array
    {
        $this->assertModuleAccess($payload);
        $search = $this->normalizeText($query['search'] ?? $query['q'] ?? '');
        $where = ['p.activo = 1'];
        $params = [];
        if ($search !== '') {
            $where[] = '(p.codigo LIKE ? OR p.categoria LIKE ? OR p.descripcion LIKE ? OR p.ubicacion LIKE ?)';
            $params[] = '%' . $search . '%';
            $params[] = '%' . $search . '%';
            $params[] = '%' . $search . '%';
            $params[] = '%' . $search . '%';
        }

        $sql = 'SELECT
                    p.id,
                    p.codigo AS codigo_producto,
                    p.categoria,
                    p.descripcion,
                    p.stock_inicial,
                    p.stock_minimo,
                    p.ubicacion,
                    p.activo,
                    COALESCE((
                        SELECT COUNT(*)
                        FROM ti_bodega_movimiento m
                        WHERE m.producto_id = p.id
                    ), 0) AS movimientos_count,
                    p.creado_en AS created_at,
                    p.actualizado_en AS updated_at,
                    (
                      p.stock_inicial
                      + COALESCE((
                          SELECT SUM(
                              CASE
                                WHEN m.tipo_movimiento IN (\'ENTRADA\', \'AJUSTE_POSITIVO\') THEN m.cantidad
                                WHEN m.tipo_movimiento IN (\'SALIDA\', \'AJUSTE_NEGATIVO\') THEN -m.cantidad
                                ELSE 0
                              END
                          )
                          FROM ti_bodega_movimiento m
                          WHERE m.producto_id = p.id
                      ), 0)
                    ) AS stock_actual
             FROM ti_bodega_producto p
             WHERE ' . implode(' AND ', $where) . '
             ORDER BY p.categoria ASC, p.descripcion ASC, p.codigo ASC';
        $rows = $this->db->fetchAll($sql, $params);
        $productos = array_map(fn (array $row) => $this->productoToViewRow($row), $rows);

        return [
            'ok' => true,
            'productos' => $productos,
        ];
    }

    private function productoToViewRow(array $row): array
    {
        $stockActual = (float)($row['stock_actual'] ?? 0);
        $stockMinimo = (float)($row['stock_minimo'] ?? 0);
        $stockInicial = (float)($row['stock_inicial'] ?? 0);
        $movimientosCount = (int)($row['movimientos_count'] ?? 0);
        $estadoStock = $stockActual <= $stockMinimo ? 'BAJO STOCK' : 'OK';
        return [
            'id' => (int)($row['id'] ?? 0),
            'codigo_producto' => $this->normalizeText($row['codigo_producto'] ?? ''),
            'categoria' => $this->normalizeText($row['categoria'] ?? ''),
            'descripcion' => $this->normalizeText($row['descripcion'] ?? ''),
            'stock_inicial' => $stockInicial,
            'stock_minimo' => $stockMinimo,
            'stock_actual' => $stockActual,
            'ubicacion' => $this->normalizeText($row['ubicacion'] ?? ''),
            'activo' => (int)($row['activo'] ?? 0),
            'movimientos_count' => $movimientosCount,
            'tiene_movimientos' => $movimientosCount > 0,
            'estado_stock' => $estadoStock,
            'created_at' => $this->normalizeText($row['created_at'] ?? $row['creado_en'] ?? ''),
            'updated_at' => $this->normalizeText($row['updated_at'] ?? $row['actualizado_en'] ?? ''),
        ];
    }

    private function guardarProductoBodega(array $payload, array $body, ?int $productoId = null): array
    {
        $this->assertModuleAccess($payload);
        $data = $this->arrayOrEmpty($body['producto'] ?? $body);
        $codigo = $this->normalizeText($data['codigo'] ?? $data['codigo_producto'] ?? '');
        if ($codigo === '') {
            throw new RuntimeException('El código del producto es requerido', 400);
        }

        $stockInicial = $this->normalizeDecimal($data['stock_inicial'] ?? 0);
        $stockMinimo = $this->normalizeDecimal($data['stock_minimo'] ?? 0);
        $existing = null;
        if ($productoId !== null) {
            $existing = $this->db->fetchOne(
                'SELECT
                    p.id,
                    p.stock_inicial,
                    COALESCE((
                        SELECT COUNT(*)
                        FROM ti_bodega_movimiento m
                        WHERE m.producto_id = p.id
                    ), 0) AS movimientos_count
                 FROM ti_bodega_producto p
                 WHERE p.id = ?
                 LIMIT 1',
                [$productoId]
            );
            if (!$existing) {
                throw new RuntimeException('El producto no existe.', 404);
            }

            $stockInicialActual = (float)($existing['stock_inicial'] ?? 0);
            $tieneMovimientos = (int)($existing['movimientos_count'] ?? 0) > 0;
            if ($tieneMovimientos && abs($stockInicial - $stockInicialActual) > 0.0001) {
                throw new RuntimeException('No se puede modificar stock_inicial cuando el producto ya tiene movimientos. Use ajustes de bodega.', 400);
            }
            if ($tieneMovimientos) {
                $stockInicial = $stockInicialActual;
            }
        }

        $insertParams = [
            $codigo,
            $this->normalizeText($data['categoria'] ?? ''),
            $this->normalizeText($data['descripcion'] ?? ''),
            $stockInicial,
            $stockMinimo,
            $this->normalizeText($data['ubicacion'] ?? ''),
            $this->normalizeBool($data['activo'] ?? 1) ?? 1,
        ];

        if ($productoId === null) {
            $this->db->execute(
                'INSERT INTO ti_bodega_producto
                 (codigo, categoria, descripcion, stock_inicial, stock_minimo, ubicacion, activo)
                 VALUES (?, ?, ?, ?, ?, ?, ?)',
                $insertParams
            );
            $productoId = (int)$this->db->mysql()->lastInsertId();
        } else {
            $updateParams = [
                $codigo,
                $this->normalizeText($data['categoria'] ?? ''),
                $this->normalizeText($data['descripcion'] ?? ''),
                $stockInicial,
                $stockMinimo,
                $this->normalizeText($data['ubicacion'] ?? ''),
                $this->normalizeBool($data['activo'] ?? 1) ?? 1,
                $productoId,
            ];
            $this->db->execute(
                'UPDATE ti_bodega_producto
                 SET codigo = ?,
                     categoria = ?,
                     descripcion = ?,
                     stock_inicial = ?,
                     stock_minimo = ?,
                     ubicacion = ?,
                     activo = ?
                 WHERE id = ?',
                $updateParams
            );
        }

        return [
            'ok' => true,
            'producto' => $this->db->fetchOne(
                'SELECT
                    p.id,
                    p.codigo AS codigo_producto,
                    p.categoria,
                    p.descripcion,
                    p.stock_inicial,
                    p.stock_minimo,
                    p.ubicacion,
                    p.activo,
                    COALESCE((
                        SELECT COUNT(*)
                        FROM ti_bodega_movimiento m
                        WHERE m.producto_id = p.id
                    ), 0) AS movimientos_count,
                    (
                      p.stock_inicial
                      + COALESCE((
                          SELECT SUM(
                              CASE
                                WHEN m.tipo_movimiento IN (\'ENTRADA\', \'AJUSTE_POSITIVO\') THEN m.cantidad
                                WHEN m.tipo_movimiento IN (\'SALIDA\', \'AJUSTE_NEGATIVO\') THEN -m.cantidad
                                ELSE 0
                              END
                          )
                          FROM ti_bodega_movimiento m
                          WHERE m.producto_id = p.id
                      ), 0)
                    ) AS stock_actual
                 FROM ti_bodega_producto p
                 WHERE p.id = ?',
                [$productoId]
            ),
        ];
    }
    private function listarMovimientosBodega(array $payload, array $query): array
    {
        $this->assertModuleAccess($payload);
        $productoId = isset($query['producto_id']) ? (int)$query['producto_id'] : 0;
        $where = [];
        $params = [];
        if ($productoId > 0) {
            $where[] = 'm.producto_id = ?';
            $params[] = $productoId;
        }

        $sql = 'SELECT
                    m.id,
                    m.producto_id,
                    p.codigo AS codigo_producto,
                    p.descripcion AS producto_descripcion,
                    m.tipo_movimiento,
                    m.cantidad,
                    m.motivo,
                    m.equipo_id,
                    e.codigo_equipo AS codigo_equipo,
                    e.usuario_asignado AS equipo_usuario_asignado,
                    m.entregado_usuario_id,
                    eu.nombre AS entregado_usuario_nombre,
                    m.entregado_a,
                    m.usuario_id,
                    m.creado_en AS created_at
                FROM ti_bodega_movimiento m
                INNER JOIN ti_bodega_producto p ON p.id = m.producto_id';
        $sql .= ' LEFT JOIN ti_equipo e ON e.id = m.equipo_id';
        $sql .= ' LEFT JOIN usuario eu ON eu.id = m.entregado_usuario_id';
        if ($where) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }
        $sql .= ' ORDER BY m.creado_en DESC, m.id DESC';

        $rows = $this->db->fetchAll($sql, $params);
        $items = array_map(static function (array $row): array {
            return [
                'id' => (int)($row['id'] ?? 0),
                'producto_id' => isset($row['producto_id']) ? (int)$row['producto_id'] : null,
                'codigo_producto' => trim((string)($row['codigo_producto'] ?? '')),
                'producto_descripcion' => trim((string)($row['producto_descripcion'] ?? '')),
                'tipo_movimiento' => trim((string)($row['tipo_movimiento'] ?? '')),
                'cantidad' => (int)($row['cantidad'] ?? 0),
                'motivo' => trim((string)($row['motivo'] ?? '')),
                'equipo_id' => isset($row['equipo_id']) ? (int)$row['equipo_id'] : null,
                'codigo_equipo' => trim((string)($row['codigo_equipo'] ?? '')),
                'equipo_usuario_asignado' => trim((string)($row['equipo_usuario_asignado'] ?? '')),
                'entregado_usuario_id' => isset($row['entregado_usuario_id']) ? (int)$row['entregado_usuario_id'] : null,
                'entregado_usuario_nombre' => trim((string)($row['entregado_usuario_nombre'] ?? '')),
                'entregado_a' => trim((string)($row['entregado_a'] ?? '')),
                'usuario_id' => isset($row['usuario_id']) ? (int)$row['usuario_id'] : null,
                'created_at' => trim((string)($row['created_at'] ?? '')),
            ];
        }, $rows);

        return ['ok' => true, 'movimientos' => $items];
    }

    private function guardarMovimientoBodega(array $payload, array $body): array
    {
        $this->assertModuleAccess($payload);
        $userId = $this->currentUserIdOrFail($payload);
        $movimiento = $this->arrayOrEmpty($body['movimiento'] ?? $body);
        $productoId = $this->resolveBodegaProductoId($movimiento['producto_id'] ?? $movimiento['productoId'] ?? null);
        if ($productoId === null) {
            throw new RuntimeException('El producto seleccionado no existe.', 400);
        }

        $tipo = strtoupper($this->normalizeText($movimiento['tipo_movimiento'] ?? ''));
        if (!in_array($tipo, self::MOVIMIENTO_TIPOS, true)) {
            throw new RuntimeException('Tipo de movimiento inválido', 400);
        }

        $cantidad = $this->normalizeDecimal($movimiento['cantidad'] ?? 0);
        if ($cantidad <= 0) {
            throw new RuntimeException('La cantidad es requerida', 400);
        }

        $stockActual = $this->obtenerStockActualBodegaProducto($productoId);
        if (in_array($tipo, ['SALIDA', 'AJUSTE_NEGATIVO'], true) && $cantidad > $stockActual) {
            throw new RuntimeException('Stock insuficiente. Disponible: ' . number_format($stockActual, 2, ',', '.'), 400);
        }

        $this->db->execute(
            'INSERT INTO ti_bodega_movimiento
             (producto_id, tipo_movimiento, cantidad, motivo, equipo_id, actividad_id, entregado_usuario_id, entregado_a, usuario_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $productoId,
                $tipo,
                $cantidad,
                $this->normalizeText($movimiento['motivo'] ?? ''),
                $this->resolveEquipoId($movimiento['equipo_id'] ?? $movimiento['equipoId'] ?? null),
                null,
                $this->resolveEntregadoUsuarioId($movimiento['entregado_usuario_id'] ?? $movimiento['entregadoUsuarioId'] ?? null),
                $this->resolveEntregadoUsuarioName($movimiento['entregado_usuario_id'] ?? $movimiento['entregadoUsuarioId'] ?? null),
                $userId,
            ]
        );

        $insertedId = (int)$this->db->mysql()->lastInsertId();

        return [
            'ok' => true,
            'movimiento' => $this->db->fetchOne(
                'SELECT m.id, m.producto_id, p.codigo AS codigo_producto, p.descripcion AS producto_descripcion, m.tipo_movimiento, m.cantidad, m.motivo, m.equipo_id, e.codigo_equipo AS codigo_equipo, e.usuario_asignado AS equipo_usuario_asignado, m.entregado_usuario_id, eu.nombre AS entregado_usuario_nombre, m.entregado_a, m.usuario_id, m.creado_en AS created_at
                 FROM ti_bodega_movimiento m
                 INNER JOIN ti_bodega_producto p ON p.id = m.producto_id
                 LEFT JOIN ti_equipo e ON e.id = m.equipo_id
                 LEFT JOIN usuario eu ON eu.id = m.entregado_usuario_id
                 WHERE m.id = ?
                 LIMIT 1',
                [$insertedId]
            ),
        ];
    }
}
