<?php
declare(strict_types=1);

final class SalesService
{
    use SharedServiceHelpers;

    public function __construct(private Database $db, private AnalyticsService $analytics)
    {
    }

    private function userInfo(int $userId): array
    {
        $row = $this->db->fetchOne('SELECT id, nombre, email, area, is_admin, is_active FROM usuario WHERE id = ? LIMIT 1', [$userId]);
        if (!$row || !(int)($row['is_active'] ?? 0)) {
            throw new RuntimeException('Usuario inactivo o no encontrado', 401);
        }
        return $row;
    }

    private function queryArray(PDO $pdo, string $sql, array $params = []): array
    {
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    private function existingConfirmation(int $userId, int $mes, int $anio): ?array
    {
        return $this->db->fetchOne(
            'SELECT * FROM confirmaciones_ventas WHERE usuario_id = ? AND mes = ? AND anio = ? LIMIT 1',
            [$userId, $mes, $anio]
        );
    }

    private function sharedReportExisting(int $userId, int $mes, int $anio): ?array
    {
        return $this->db->fetchOne(
            'SELECT * FROM reporte_venta_compartida_confirmacion WHERE vendedor_usuario_id = ? AND mes = ? AND anio = ? LIMIT 1',
            [$userId, $mes, $anio]
        );
    }

    private function buildSalesPdf(string $title, array $lines, string $path): void
    {
        $pdf = build_simple_pdf($lines, $title);
        $dir = dirname($path);
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        file_put_contents($path, $pdf);
    }

    public function confirmar(array $payload, array $body): array
    {
        $userId = $this->userId($payload);
        $user = $this->userInfo($userId);
        $params = $this->monthYear($body);
        $mes = $params['mes'];
        $anio = $params['anio'];

        if ($this->existingConfirmation($userId, $mes, $anio)) {
            throw new RuntimeException("Ya confirmaste el período $mes/$anio. Solo se permite una confirmación por mes.", 409);
        }

        $ventasPropias = $this->analytics->ventasMes($payload, ['mes' => $mes, 'anio' => $anio])['ventas'] ?? [];
        $totalPropias = array_reduce($ventasPropias, static fn(int $acc, array $row): int => $acc + (int)($row['monto'] ?? 0), 0);

        $rowsAsignadas = $this->db->fetchAll(
            'SELECT folio, cliente, fecha, monto_asignado, porcentaje, rol, cod_vendedor_principal, cod_vendedor_compartido, nombre_vendedor_compartido
             FROM factura_compartida
             WHERE usuario_id = ? AND mes = ? AND anio = ?
             ORDER BY fecha',
            [$userId, $mes, $anio]
        );
        $totalAsignadas = array_reduce($rowsAsignadas, static fn(int $acc, array $row): int => $acc + (int)round((float)($row['monto_asignado'] ?? 0)), 0);

        $meta = $this->db->fetchOne(
            "SELECT meta FROM vendedor_meta
             WHERE usuario_id = ? AND YEAR(fecha) = ?
               AND ((tipo_periodo = 'mensual' AND MONTH(fecha) = ?) OR tipo_periodo = 'anual')
               AND COALESCE(activo, 1) = 1
             ORDER BY CASE WHEN tipo_periodo = 'mensual' THEN 0 ELSE 1 END, fecha ASC, id ASC
             LIMIT 1",
            [$userId, $anio, $mes]
        );

        $periodLabel = sprintf('%s %d', ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][$mes] ?? 'Mes', $anio);
        $nombreArchivo = sprintf('confirmacion_u%d_%d_%02d.pdf', $userId, $anio, $mes);
        $rutaRelativa = 'storage/confirmaciones/' . $nombreArchivo;
        $rutaAbsoluta = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . $rutaRelativa;
        $this->buildSalesPdf(
            'Confirmacion de ventas ' . $periodLabel,
            [
                'TEXPRO - Confirmacion de ventas',
                'Usuario: ' . ($user['nombre'] ?? ''),
                'Periodo: ' . $periodLabel,
                'Ventas propias: ' . number_format($totalPropias, 0, ',', '.'),
                'Ventas asignadas: ' . number_format($totalAsignadas, 0, ',', '.'),
                'Total folios: ' . count($ventasPropias),
                'Facturas compartidas: ' . count($rowsAsignadas),
                'Meta: ' . number_format((float)($meta['meta'] ?? 0), 0, ',', '.'),
            ],
            $rutaAbsoluta
        );

        $stmt = $this->db->mysql()->prepare(
            'INSERT INTO confirmaciones_ventas
                (usuario_id, mes, anio, fecha_confirmacion, ruta_pdf, nombre_archivo,
                 total_ventas_propias, total_ventas_asignadas, total_folios, total_facturas_compartidas, ip_confirmacion)
             VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $userId,
            $mes,
            $anio,
            $rutaRelativa,
            $nombreArchivo,
            $totalPropias,
            $totalAsignadas,
            count($ventasPropias),
            count($rowsAsignadas),
            $_SERVER['REMOTE_ADDR'] ?? null,
        ]);

        return [
            'ok' => true,
            'id' => (int)$this->db->mysql()->lastInsertId(),
            'nombreArchivo' => $nombreArchivo,
            'totalPropias' => $totalPropias,
            'totalAsignadas' => $totalAsignadas,
            'totalFolios' => count($ventasPropias),
        ];
    }

    public function getPdf(int $userId, int $id): array
    {
        $row = $this->db->fetchOne('SELECT * FROM confirmaciones_ventas WHERE id = ? LIMIT 1', [$id]);
        if (!$row) {
            throw new RuntimeException('Confirmación no encontrada', 404);
        }
        if (!(bool)($this->userInfo($userId)['is_admin'] ?? false) && (int)$row['usuario_id'] !== $userId) {
            throw new RuntimeException('Sin permiso para este archivo', 403);
        }

        $path = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . (string)$row['ruta_pdf'];
        if (!is_file($path)) {
            throw new RuntimeException('Archivo no encontrado', 404);
        }
        return ['filename' => (string)$row['nombre_archivo'], 'bytes' => file_get_contents($path) ?: ''];
    }

    public function sharedConfirmationState(array $payload, array $query): array
    {
        $userId = $this->userId($payload);
        $params = $this->monthYear($query);
        $row = $this->sharedReportExisting($userId, $params['mes'], $params['anio']);
        return [
            'ok' => true,
            'existe' => (bool)$row,
            'confirmado' => (bool)$row,
            'estado' => $row['estado'] ?? null,
            'confirmado_at' => $row['confirmado_at'] ?? null,
            'revisado_at' => $row['revisado_at'] ?? null,
            'motivo_rechazo' => $row['motivo_rechazo'] ?? null,
            'comentario_rrhh' => $row['comentario_rrhh'] ?? null,
            'reporte' => $row ? [
                'id' => (int)$row['id'],
                'estado' => $row['estado'],
                'confirmado_at' => $row['confirmado_at'],
                'revisado_at' => $row['revisado_at'],
                'motivo_rechazo' => $row['motivo_rechazo'] ?? null,
                'comentario_rrhh' => $row['comentario_rrhh'] ?? null,
                'periodo_label' => $row['periodo_label'] ?? null,
            ] : null,
        ];
    }

    public function confirmShared(array $payload, array $body): array
    {
        $userId = $this->userId($payload);
        $user = $this->userInfo($userId);
        $params = $this->monthYear($body);
        $mes = $params['mes'];
        $anio = $params['anio'];

        $exist = $this->sharedReportExisting($userId, $mes, $anio);
        if ($exist && in_array((string)$exist['estado'], ['confirmado_vendedor', 'validado_rrhh'], true)) {
            throw new RuntimeException(
                $exist['estado'] === 'validado_rrhh' ? 'Este reporte ya fue validado por RRHH.' : 'Este reporte ya fue confirmado y enviado a RRHH.',
                409
            );
        }

        $rows = $this->db->fetchAll(
            'SELECT folio, cliente, fecha, monto_asignado, porcentaje, cod_vendedor_principal, cod_vendedor_compartido, nombre_vendedor_compartido
             FROM factura_compartida
             WHERE usuario_id = ? AND mes = ? AND anio = ?
             ORDER BY fecha',
            [$userId, $mes, $anio]
        );
        if (!$rows) {
            throw new RuntimeException('No hay folios asignados para confirmar en este período.', 404);
        }

        $totalAsignado = array_reduce($rows, static fn(int $acc, array $row): int => $acc + (int)round((float)($row['monto_asignado'] ?? 0)), 0);
        $periodLabel = sprintf('%s %d', ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][$mes] ?? 'Mes', $anio);
        $snapshot = [
            'tipo' => 'folios_asignados',
            'resumen' => [
                'cantidad_folios' => count($rows),
                'cantidad_lineas' => count($rows),
                'total_monto_asignado' => $totalAsignado,
                'total_venta' => $totalAsignado,
                'total_venta_real' => $totalAsignado,
                'total_descuento' => 0,
                'total_comision' => $totalAsignado,
            ],
            'folios_asignados' => array_map(static fn(array $row): array => [
                'folio' => (string)$row['folio'],
                'fecha' => (string)$row['fecha'],
                'cliente' => (string)$row['cliente'],
                'vendedor_asignado' => (string)($row['nombre_vendedor_compartido'] ?? $row['cod_vendedor_compartido'] ?? ''),
                'porcentaje_participacion' => (float)($row['porcentaje'] ?? 0),
                'monto_asignado' => (float)($row['monto_asignado'] ?? 0),
            ], $rows),
            'periodo' => ['anio' => $anio, 'mes' => $mes, 'label' => $periodLabel],
            'generado_en' => gmdate('c'),
            'confirmacion' => [
                'confirmado_por' => $userId,
                'confirmado_at' => gmdate('c'),
            ],
            'usuario' => [
                'id' => $userId,
                'nombre' => $user['nombre'] ?? '',
                'email' => $user['email'] ?? '',
                'area' => $user['area'] ?? '',
            ],
        ];

        $nombreArchivo = sprintf('reporte_compartido_u%d_%d_%02d.pdf', $userId, $anio, $mes);
        $rutaRelativa = 'storage/confirmaciones/' . $nombreArchivo;
        $rutaAbsoluta = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . $rutaRelativa;
        $this->buildSalesPdf(
            'Reporte de ventas compartidas ' . $periodLabel,
            [
                'TEXPRO - Reporte de ventas compartidas',
                'Usuario: ' . ($user['nombre'] ?? ''),
                'Periodo: ' . $periodLabel,
                'Cantidad de folios: ' . count($rows),
                'Monto asignado total: ' . number_format($totalAsignado, 0, ',', '.'),
            ],
            $rutaAbsoluta
        );

        $stmt = $this->db->mysql()->prepare(
            'INSERT INTO reporte_venta_compartida_confirmacion
              (vendedor_usuario_id, vendedor_nombre, vendedor_email, anio, mes, periodo_label,
               total_venta, total_venta_real, total_descuento, total_comision,
               cantidad_folios, cantidad_lineas, reporte_json, reporte_pdf_path,
               estado, confirmado_por, confirmado_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'confirmado_vendedor\', ?, NOW())
             ON DUPLICATE KEY UPDATE
               vendedor_nombre = VALUES(vendedor_nombre),
               vendedor_email = VALUES(vendedor_email),
               periodo_label = VALUES(periodo_label),
               total_venta = VALUES(total_venta),
               total_venta_real = VALUES(total_venta_real),
               total_descuento = VALUES(total_descuento),
               total_comision = VALUES(total_comision),
               cantidad_folios = VALUES(cantidad_folios),
               cantidad_lineas = VALUES(cantidad_lineas),
               reporte_json = VALUES(reporte_json),
               reporte_pdf_path = VALUES(reporte_pdf_path),
               estado = \'confirmado_vendedor\',
               confirmado_por = VALUES(confirmado_por),
               confirmado_at = NOW(),
               revisado_por = NULL,
               revisado_at = NULL,
               comentario_rrhh = NULL,
               rechazado_por = NULL,
               rechazado_at = NULL,
               motivo_rechazo = NULL'
        );
        $stmt->execute([
            $userId,
            $user['nombre'] ?? '',
            $user['email'] ?? null,
            $anio,
            $mes,
            $periodLabel,
            $totalAsignado,
            $totalAsignado,
            0,
            $totalAsignado,
            count($rows),
            count($rows),
            json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            $rutaRelativa,
            $userId,
        ]);

        $this->notifyRrhhAdmins($user, $mes, $anio, $periodLabel);

        $saved = $this->sharedReportExisting($userId, $mes, $anio);

        return [
            'ok' => true,
            'id' => (int)($saved['id'] ?? $this->db->mysql()->lastInsertId()),
            'estado' => 'confirmado_vendedor',
            'mensaje' => 'Ventas compartidas confirmadas y enviadas a RRHH.',
            'resumen' => $snapshot['resumen'],
            'periodo' => $snapshot['periodo'],
        ];
    }

    private function notifyRrhhAdmins(array $user, int $mes, int $anio, string $periodLabel): void
    {
        $rows = $this->db->fetchAll(
            "SELECT id FROM usuario
             WHERE is_active = 1
               AND (is_admin = 1 OR LOWER(TRIM(COALESCE(area, ''))) IN ('rrhh', 'recursos humanos', 'rh'))"
        );
        foreach ($rows as $row) {
            $userId = (int)($row['id'] ?? 0);
            if ($userId <= 0) {
                continue;
            }
            $this->db->execute(
                'INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, folio, mes, anio) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [
                    $userId,
                    'reporte_compartido_enviado',
                    'Nuevo reporte de ventas compartidas',
                    sprintf('%s envió su reporte de ventas compartidas de %s para revisión de RRHH.', $user['nombre'] ?? 'Un vendedor', $periodLabel),
                    null,
                    $mes,
                    $anio,
                ]
            );
        }
    }
}
