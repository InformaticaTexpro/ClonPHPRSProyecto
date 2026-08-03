<?php
declare(strict_types=1);

final class RrhhService
{
    public function __construct(private Database $db)
    {
    }

    private function assertRrhh(array $payload): void
    {
        if (!(bool)($payload['is_admin'] ?? false) && $this->normalizeArea($payload['area'] ?? '') !== 'rrhh') {
            throw new RuntimeException('Solo RRHH o administradores', 403);
        }
    }

    private function normalizeText(mixed $value): string
    {
        return trim((string)$value);
    }

    private function normalizeArea(mixed $value): string
    {
        $text = $this->normalizeText($value);
        $text = mb_strtolower($text);
        $text = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $text) ?: $text;
        $text = preg_replace('/\s+/', '-', $text) ?? $text;
        $text = preg_replace('/[^a-z0-9-]/', '', $text) ?? $text;
        return trim($text, '-');
    }

    private function parseId(mixed $value, string $label = 'ID'): int
    {
        if (!is_numeric($value) || (int)$value <= 0) {
            throw new RuntimeException($label . ' inválido', 400);
        }
        return (int)$value;
    }

    private function parseMesAnio(array $query): array
    {
        $now = new DateTimeImmutable('now');
        $mes = isset($query['mes']) && $query['mes'] !== '' ? (int)$query['mes'] : (int)$now->format('n');
        $anio = isset($query['anio']) && $query['anio'] !== '' ? (int)$query['anio'] : (int)$now->format('Y');
        if ($mes < 1 || $mes > 12) {
            throw new RuntimeException('Mes inválido. Debe estar entre 1 y 12.', 400);
        }
        if ($anio < 2026 || $anio > 2100) {
            throw new RuntimeException('Año inválido. Debe estar entre 2026 y 2100.', 400);
        }
        return ['mes' => $mes, 'anio' => $anio];
    }

    private function parseBool(mixed $value): bool
    {
        if (is_bool($value)) return $value;
        if (is_int($value) || is_float($value)) return (int)$value !== 0;
        $text = mb_strtolower($this->normalizeText($value));
        return in_array($text, ['1', 'true', 'si', 'sí', 'yes', 'y', 'on'], true);
    }

    private function formatPeriodoLabel(int $anio, int $mes): string
    {
        $months = [
            1 => 'Enero', 2 => 'Febrero', 3 => 'Marzo', 4 => 'Abril',
            5 => 'Mayo', 6 => 'Junio', 7 => 'Julio', 8 => 'Agosto',
            9 => 'Septiembre', 10 => 'Octubre', 11 => 'Noviembre', 12 => 'Diciembre',
        ];
        return ($months[$mes] ?? 'Mes') . ' ' . $anio;
    }

    private function parseReporteJson(mixed $value): ?array
    {
        if (is_array($value)) return $value;
        if ($value === null || $value === '') return null;
        $json = json_decode((string)$value, true);
        return is_array($json) ? $json : null;
    }

    private function safeJson(mixed $value): ?string
    {
        if ($value === null || $value === '') return null;
        return is_string($value) ? $value : json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    private function extractSnapshotFolios(?array $reporteJson): array
    {
        if (!$reporteJson) return [];
        $folios = [];
        if (isset($reporteJson['folios_asignados']) && is_array($reporteJson['folios_asignados'])) {
            $folios = $reporteJson['folios_asignados'];
        } elseif (isset($reporteJson['detalle']) && is_array($reporteJson['detalle'])) {
            $folios = $reporteJson['detalle'];
        }

        return array_values(array_filter(array_map(function (array $item): array {
            $folio = $this->normalizeText($item['folio'] ?? '');
            return [
                'folio' => $folio,
                'fecha' => $this->normalizeText($item['fecha'] ?? ''),
                'cliente' => $this->normalizeText($item['cliente'] ?? ''),
                'vendedor_asignado' => $this->normalizeText($item['vendedor_asignado'] ?? $item['nombre_vendedor_compartido'] ?? $item['cod_vendedor_compartido'] ?? ''),
                'vendedor_asignador' => $this->normalizeText($item['vendedor_asignador'] ?? $item['vendedor_origen'] ?? $item['cod_vendedor_principal'] ?? ''),
                'porcentaje_participacion' => (float)($item['porcentaje_participacion'] ?? $item['porcentaje'] ?? 0),
                'monto_asignado' => (float)($item['monto_asignado'] ?? $item['monto'] ?? 0),
            ];
        }, $folios), static fn(array $item): bool => $item['folio'] !== ''));
    }

    private function hasDifferences(array $reporteJson): bool
    {
        $diffs = [];
        if (isset($reporteJson['comparacion']) && is_array($reporteJson['comparacion'])) {
            $diffs = $reporteJson['comparacion'];
        } elseif (isset($reporteJson['diferencias']) && is_array($reporteJson['diferencias'])) {
            $diffs = $reporteJson['diferencias'];
        }
        if ($diffs) {
            return true;
        }
        foreach ($this->extractSnapshotFolios($reporteJson) as $row) {
            if ((float)$row['monto_asignado'] === 0.0 || (float)$row['porcentaje_participacion'] === 0.0) {
                return true;
            }
        }
        return false;
    }

    private function buildReporteRow(array $row): array
    {
        $json = $this->parseReporteJson($row['reporte_json'] ?? null);
        return [
            ...$row,
            'id' => (int)($row['id'] ?? 0),
            'vendedor_usuario_id' => isset($row['vendedor_usuario_id']) ? (int)$row['vendedor_usuario_id'] : null,
            'anio' => isset($row['anio']) ? (int)$row['anio'] : null,
            'mes' => isset($row['mes']) ? (int)$row['mes'] : null,
            'periodo_label' => $row['periodo_label'] ?? null,
            'total_venta' => (float)($row['total_venta'] ?? 0),
            'total_venta_real' => (float)($row['total_venta_real'] ?? 0),
            'total_descuento' => (float)($row['total_descuento'] ?? 0),
            'total_comision' => (float)($row['total_comision'] ?? 0),
            'cantidad_folios' => (int)($row['cantidad_folios'] ?? 0),
            'cantidad_lineas' => (int)($row['cantidad_lineas'] ?? 0),
            'reporte_json' => $json,
            'folios_asignados' => $this->extractSnapshotFolios($json),
            'tiene_diferencias' => $json ? $this->hasDifferences($json) : false,
        ];
    }

    private function withTransaction(callable $work): mixed
    {
        $pdo = $this->db->mysql();
        $pdo->beginTransaction();
        try {
            $result = $work($pdo);
            $pdo->commit();
            return $result;
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    private function notifyUser(int $usuarioId, string $tipo, string $titulo, string $mensaje, ?int $mes = null, ?int $anio = null, ?string $folio = null): void
    {
        $stmt = $this->db->mysql()->prepare(
            'INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, leida, folio, mes, anio, fecha_creacion)
             VALUES (?, ?, ?, ?, 0, ?, ?, ?, NOW())'
        );
        $stmt->execute([$usuarioId, $tipo, $titulo, $mensaje, $folio, $mes, $anio]);
    }

    public function confirmaciones(array $payload, array $query): array
    {
        $this->assertRrhh($payload);
        $filters = $this->parseMesAnio($query);
        $where = [];
        $params = [];
        if (!empty($query['mes']) || !empty($query['anio'])) {
            $where[] = 'cv.anio = ?';
            $params[] = $filters['anio'];
            $where[] = 'cv.mes = ?';
            $params[] = $filters['mes'];
        }

        $sql = 'SELECT cv.id, cv.usuario_id, u.nombre, u.email, cv.mes, cv.anio, cv.fecha_confirmacion, cv.nombre_archivo, cv.total_ventas_propias, cv.total_ventas_asignadas, cv.total_folios, cv.total_facturas_compartidas
                FROM confirmaciones_ventas cv
                INNER JOIN usuario u ON u.id = cv.usuario_id';
        if ($where) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }
        $sql .= ' ORDER BY cv.fecha_confirmacion DESC';

        $rows = $this->db->fetchAll($sql, $params);
        return ['ok' => true, 'confirmaciones' => $rows];
    }

    public function confirmacionPdf(array $payload, int $id): array
    {
        $this->assertRrhh($payload);
        $row = $this->db->fetchOne(
            'SELECT cv.*, u.nombre, u.email
             FROM confirmaciones_ventas cv
             INNER JOIN usuario u ON u.id = cv.usuario_id
             WHERE cv.id = ? LIMIT 1',
            [$id]
        );
        if (!$row) {
            throw new RuntimeException('Confirmacion no encontrada', 404);
        }

        $path = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . (string)$row['ruta_pdf'];
        if (!is_file($path)) {
            throw new RuntimeException('Archivo PDF no encontrado en disco', 404);
        }

        return [
            'filename' => (string)($row['nombre_archivo'] ?? 'confirmacion.pdf'),
            'bytes' => file_get_contents($path) ?: '',
        ];
    }

    public function reportesCompartidos(array $payload, array $query): array
    {
        $this->assertRrhh($payload);
        $rows = $this->listarReportes($query);
        $filtered = $rows;

        if ($this->parseBool($query['solo_con_diferencias'] ?? false)) {
            $filtered = array_values(array_filter($filtered, function (array $reporte): bool {
                if (!empty($reporte['tiene_diferencias'])) {
                    return true;
                }
                foreach ($this->extractSnapshotFolios($reporte['reporte_json']) as $folioRow) {
                    if ((float)$folioRow['monto_asignado'] <= 0 || (float)$folioRow['porcentaje_participacion'] <= 0) {
                        return true;
                    }
                }
                return false;
            }));
        }

        if (!empty($query['folio'])) {
            $folioBuscado = $this->normalizeText($query['folio']);
            $filtered = array_values(array_filter($filtered, function (array $reporte) use ($folioBuscado): bool {
                foreach ($this->extractSnapshotFolios($reporte['reporte_json']) as $folioRow) {
                    if ($this->normalizeText($folioRow['folio']) === $folioBuscado) {
                        return true;
                    }
                }
                return false;
            }));
        }

        return ['ok' => true, 'reportes' => $filtered];
    }

    private function listarReportes(array $query): array
    {
        $where = [];
        $params = [];
        if (!empty($query['anio'])) {
            $where[] = 'r.anio = ?';
            $params[] = (int)$query['anio'];
        }
        if (!empty($query['mes'])) {
            $where[] = 'r.mes = ?';
            $params[] = (int)$query['mes'];
        }
        if (!empty($query['estado']) && $query['estado'] !== 'todos') {
            $where[] = 'r.estado = ?';
            $params[] = (string)$query['estado'];
        }
        if (!empty($query['vendedor_usuario_id'])) {
            $where[] = 'r.vendedor_usuario_id = ?';
            $params[] = (int)$query['vendedor_usuario_id'];
        }
        if (!empty($query['vendedor_nombre'])) {
            $like = '%' . mb_strtolower(trim((string)$query['vendedor_nombre'])) . '%';
            $where[] = '(LOWER(r.vendedor_nombre) LIKE ? OR LOWER(COALESCE(r.vendedor_email, "")) LIKE ?)';
            $params[] = $like;
            $params[] = $like;
        }

        $sql = 'SELECT r.*, u.nombre AS confirmado_por_nombre, ur.nombre AS revisado_por_nombre, ur2.nombre AS rechazado_por_nombre
                FROM reporte_venta_compartida_confirmacion r
                LEFT JOIN usuario u ON u.id = r.confirmado_por
                LEFT JOIN usuario ur ON ur.id = r.revisado_por
                LEFT JOIN usuario ur2 ON ur2.id = r.rechazado_por';
        if ($where) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }
        $sql .= ' ORDER BY r.confirmado_at DESC, r.id DESC';
        $rows = $this->db->fetchAll($sql, $params);
        $result = array_map(fn(array $row): array => $this->buildReporteRow($row), $rows);

        if (!empty($query['folio'])) {
            $folioBuscado = $this->normalizeText($query['folio']);
            $result = array_values(array_filter($result, function (array $reporte) use ($folioBuscado): bool {
                foreach ($reporte['folios_asignados'] as $folioRow) {
                    if ($this->normalizeText($folioRow['folio']) === $folioBuscado) {
                        return true;
                    }
                }
                return false;
            }));
        }

        return $result;
    }

    public function reporteCompartido(array $payload, int $id): array
    {
        $this->assertRrhh($payload);
        $row = $this->db->fetchOne(
            'SELECT r.*, u.nombre AS confirmado_por_nombre, ur.nombre AS revisado_por_nombre, ur2.nombre AS rechazado_por_nombre
             FROM reporte_venta_compartida_confirmacion r
             LEFT JOIN usuario u ON u.id = r.confirmado_por
             LEFT JOIN usuario ur ON ur.id = r.revisado_por
             LEFT JOIN usuario ur2 ON ur2.id = r.rechazado_por
             WHERE r.id = ? LIMIT 1',
            [$id]
        );
        if (!$row) {
            throw new RuntimeException('Reporte compartido no encontrado', 404);
        }
        $reporte = $this->buildReporteRow($row);
        return [
            'ok' => true,
            'cabecera' => [
                'id' => $reporte['id'],
                'vendedor_usuario_id' => $reporte['vendedor_usuario_id'],
                'vendedor_nombre' => $reporte['vendedor_nombre'],
                'vendedor_email' => $reporte['vendedor_email'],
                'anio' => $reporte['anio'],
                'mes' => $reporte['mes'],
                'periodo_label' => $reporte['periodo_label'],
                'total_venta' => $reporte['total_venta'],
                'total_venta_real' => $reporte['total_venta_real'],
                'total_descuento' => $reporte['total_descuento'],
                'total_comision' => $reporte['total_comision'],
                'cantidad_folios' => $reporte['cantidad_folios'],
                'cantidad_lineas' => $reporte['cantidad_lineas'],
                'estado' => $reporte['estado'],
                'confirmado_at' => $reporte['confirmado_at'],
                'revisado_at' => $reporte['revisado_at'],
                'comentario_rrhh' => $reporte['comentario_rrhh'],
                'motivo_rechazo' => $reporte['motivo_rechazo'],
            ],
            'resumen' => [
                'cantidad_folios' => $reporte['cantidad_folios'],
                'cantidad_lineas' => $reporte['cantidad_lineas'],
                'total_venta' => $reporte['total_venta'],
                'total_venta_real' => $reporte['total_venta_real'],
                'total_descuento' => $reporte['total_descuento'],
                'total_comision' => $reporte['total_comision'],
            ],
            'reporte_json' => $reporte['reporte_json'] ?? null,
            'folios_asignados' => $reporte['folios_asignados'],
            'estado' => $reporte['estado'],
            'comentario_rrhh' => $reporte['comentario_rrhh'],
            'motivo_rechazo' => $reporte['motivo_rechazo'],
            'historial' => array_values(array_filter([
                [
                    'estado' => 'confirmado_vendedor',
                    'fecha' => $reporte['confirmado_at'],
                    'usuario' => $reporte['confirmado_por_nombre'] ?? null,
                ],
                !empty($reporte['revisado_at'])
                    ? [
                        'estado' => $reporte['estado'],
                        'fecha' => $reporte['revisado_at'],
                        'usuario' => $reporte['revisado_por_nombre'] ?? null,
                        'comentario' => $reporte['comentario_rrhh'] ?? null,
                    ]
                    : (!empty($reporte['rechazado_at'])
                        ? [
                            'estado' => $reporte['estado'],
                            'fecha' => $reporte['rechazado_at'],
                            'usuario' => $reporte['rechazado_por_nombre'] ?? null,
                            'comentario' => $reporte['motivo_rechazo'] ?? null,
                        ]
                        : null),
            ])),
        ];
    }

    private function periodoRevision(array $query): array
    {
        $anio = $this->parseId($query['anio'] ?? null, 'Año');
        $mes = $this->parseId($query['mes'] ?? null, 'Mes');
        if ($anio < 2026 || $anio > 2100 || $mes < 1 || $mes > 12) {
            throw new RuntimeException('Año o mes inválido', 400);
        }
        return ['anio' => $anio, 'mes' => $mes];
    }

    private function softlandCodes(): array
    {
        return [
            'C001', 'C002', 'C003',
        ];
    }

    private function listarFoliosSoftlandCompartidos(int $anio, int $mes, array $codigosCompartidos = []): array
    {
        $codes = array_values(array_filter(array_map([$this, 'normalizeText'], $codigosCompartidos)));
        if (!$codes) {
            $codes = $this->softlandCodes();
        }

        $placeholders = implode(',', array_fill(0, count($codes), '?'));
        $pdo = $this->db->softland();
        $stmt = $pdo->prepare(
            "SELECT
                h.Folio,
                CONVERT(VARCHAR(10), h.Fecha, 120) AS fecha_iso,
                CONVERT(VARCHAR(10), h.Fecha, 103) AS fecha,
                h.CodVendedor AS cod_vendedor_softland,
                COALESCE(vend.VenDes, h.CodVendedor) AS vendedor_softland,
                RTRIM(COALESCE(c.NomAux, '')) AS cliente,
                ROUND(SUM(m.TotLinea), 0) AS total_softland
             FROM [PRODIN].[softland].[iw_gsaen] h
             INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = h.NroInt AND m.Tipo = h.Tipo
             LEFT JOIN [PRODIN].[softland].[cwtauxi] c ON c.CodAux = h.CodAux
             LEFT JOIN [PRODIN].[softland].[cwtvend] vend ON vend.VenCod = h.CodVendedor
             WHERE h.CodVendedor IN ($placeholders)
               AND h.Estado <> 'A'
               AND h.Tipo = 'F'
               AND h.Fecha >= ?
               AND h.Fecha < ?
             GROUP BY h.Folio, h.Fecha, h.CodVendedor, vend.VenDes, c.NomAux
             ORDER BY h.Fecha DESC, h.Folio DESC"
        );
        $fechaInicio = sprintf('%04d-%02d-01 00:00:00', $anio, $mes);
        $next = new DateTimeImmutable(sprintf('%04d-%02d-01', $anio, $mes));
        $fechaFin = $next->modify('+1 month')->format('Y-m-d 00:00:00');
        $stmt->execute([...$codes, $fechaInicio, $fechaFin]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        return array_map(static function (array $row): array {
            return [
                'folio' => trim((string)($row['Folio'] ?? '')),
                'fecha' => trim((string)($row['fecha_iso'] ?? $row['fecha'] ?? '')),
                'fecha_formato' => trim((string)($row['fecha'] ?? '')),
                'cliente' => trim((string)($row['cliente'] ?? '')),
                'cod_vendedor_softland' => trim((string)($row['cod_vendedor_softland'] ?? '')),
                'vendedor_softland' => trim((string)($row['vendedor_softland'] ?? '')),
                'total_softland' => (float)($row['total_softland'] ?? 0),
                'existe_softland' => true,
            ];
        }, $rows);
    }

    private function listarFoliosAsignadosRevision(int $anio, int $mes, array $codigosAsignador = [], array $codigosAsignado = [], ?string $folio = null): array
    {
        $where = ["fc.rol = 'compartido'", 'fc.anio = ?', 'fc.mes = ?'];
        $params = [$anio, $mes];
        if ($folio !== null && trim($folio) !== '') {
            $where[] = 'CAST(fc.folio AS CHAR) = ?';
            $params[] = trim($folio);
        }
        if ($codigosAsignador) {
            $where[] = 'fc.cod_vendedor_principal IN (' . implode(',', array_fill(0, count($codigosAsignador), '?')) . ')';
            $params = array_merge($params, array_map([$this, 'normalizeText'], $codigosAsignador));
        }
        if ($codigosAsignado) {
            $where[] = 'fc.cod_vendedor_compartido IN (' . implode(',', array_fill(0, count($codigosAsignado), '?')) . ')';
            $params = array_merge($params, array_map([$this, 'normalizeText'], $codigosAsignado));
        }

        $sql = 'SELECT fc.id, fc.folio, fc.fecha, fc.cliente, fc.monto_neto, fc.monto_asignado, fc.porcentaje, fc.cod_vendedor_principal, fc.cod_vendedor_compartido, fc.nombre_vendedor_compartido, fc.mes, fc.anio, fc.rol,
                       uvo.usuario_id AS vendedor_asignador_id, uva.usuario_id AS vendedor_asignado_id,
                       COALESCE(uo.nombre, fc.cod_vendedor_principal) AS vendedor_asignador,
                       COALESCE(ua.nombre, fc.nombre_vendedor_compartido, fc.cod_vendedor_compartido) AS vendedor_asignado
                FROM factura_compartida fc
                LEFT JOIN usuario_vendedor uvo ON uvo.cod_vendedor = fc.cod_vendedor_principal
                LEFT JOIN usuario uo ON uo.id = uvo.usuario_id
                LEFT JOIN usuario_vendedor uva ON uva.cod_vendedor = fc.cod_vendedor_compartido
                LEFT JOIN usuario ua ON ua.id = uva.usuario_id
                WHERE ' . implode(' AND ', $where) . '
                ORDER BY fc.fecha DESC, fc.folio DESC, fc.id DESC';
        $rows = $this->db->fetchAll($sql, $params);
        return array_map(static function (array $row): array {
            return [
                'id' => (int)$row['id'],
                'folio' => trim((string)$row['folio']),
                'fecha' => trim((string)$row['fecha']),
                'cliente' => trim((string)$row['cliente']),
                'monto_neto' => (float)($row['monto_neto'] ?? 0),
                'monto_asignado' => (float)($row['monto_asignado'] ?? 0),
                'porcentaje' => (float)($row['porcentaje'] ?? 0),
                'cod_vendedor_principal' => trim((string)($row['cod_vendedor_principal'] ?? '')),
                'cod_vendedor_compartido' => trim((string)($row['cod_vendedor_compartido'] ?? '')),
                'vendedor_asignador_id' => isset($row['vendedor_asignador_id']) ? (int)$row['vendedor_asignador_id'] : null,
                'vendedor_asignado_id' => isset($row['vendedor_asignado_id']) ? (int)$row['vendedor_asignado_id'] : null,
                'nombre_vendedor_compartido' => trim((string)($row['nombre_vendedor_compartido'] ?? '')),
                'vendedor_asignador' => trim((string)($row['vendedor_asignador'] ?? '')),
                'vendedor_asignado' => trim((string)($row['vendedor_asignado'] ?? '')),
                'mes' => isset($row['mes']) ? (int)$row['mes'] : null,
                'anio' => isset($row['anio']) ? (int)$row['anio'] : null,
                'rol' => trim((string)($row['rol'] ?? '')),
                'existe_asignacion' => true,
            ];
        }, $rows);
    }

    private function obtenerCodigosVendedorPorUsuarioId(?int $usuarioId): array
    {
        if (!$usuarioId) return [];
        $rows = $this->db->fetchAll(
            'SELECT DISTINCT TRIM(cod_vendedor) AS cod_vendedor FROM usuario_vendedor WHERE usuario_id = ? AND cod_vendedor IS NOT NULL AND TRIM(cod_vendedor) <> ""',
            [$usuarioId]
        );
        return array_values(array_filter(array_map(fn(array $row): string => $this->normalizeText($row['cod_vendedor'] ?? ''), $rows)));
    }

    private function compararRevision(array $softland, array $asignaciones, array $reportes): array
    {
        $softlandByFolio = [];
        foreach ($softland as $row) {
            $folio = $this->normalizeText($row['folio'] ?? '');
            if ($folio !== '' && !isset($softlandByFolio[$folio])) {
                $softlandByFolio[$folio] = $row;
            }
        }
        $asignacionesByFolio = [];
        foreach ($asignaciones as $row) {
            $folio = $this->normalizeText($row['folio'] ?? '');
            if ($folio !== '') {
                $asignacionesByFolio[$folio][] = $row;
            }
        }
        $reportesByFolio = [];
        foreach ($reportes as $reporte) {
            foreach ($reporte['folios_asignados'] as $folioRow) {
                $folio = $this->normalizeText($folioRow['folio'] ?? '');
                if ($folio !== '') {
                    $reportesByFolio[$folio][] = ['reporte' => $reporte, 'folio' => $folioRow];
                }
            }
        }

        $allFolios = array_unique(array_merge(array_keys($softlandByFolio), array_keys($asignacionesByFolio), array_keys($reportesByFolio)));
        sort($allFolios, SORT_NATURAL);

        $comparacion = [];
        foreach ($allFolios as $folio) {
            $soft = $softlandByFolio[$folio] ?? null;
            $asigRows = $asignacionesByFolio[$folio] ?? [];
            $repRows = $reportesByFolio[$folio] ?? [];
            $asig = $asigRows[0] ?? null;
            $repItem = $repRows[0] ?? null;
            $reporte = $repItem['reporte'] ?? null;
            $snapshot = $repItem['folio'] ?? null;
            $diffs = [];

            if ($soft && !$asig) $diffs[] = 'Folio de código compartido sin asignación registrada.';
            if ($asig && !$repItem) $diffs[] = 'Folio asignado no incluido en reporte confirmado.';
            if (!$soft && $repItem) $diffs[] = 'Folio reportado no encontrado en Softland para códigos compartidos.';
            if (count($repRows) > 1) $diffs[] = 'Folio duplicado en reporte confirmado.';

            if ($asig && $snapshot) {
                if ((float)$asig['monto_asignado'] !== (float)$snapshot['monto_asignado']) {
                    $diffs[] = 'Monto asignado distinto al reportado.';
                }
                if ((float)$asig['porcentaje'] !== (float)$snapshot['porcentaje_participacion']) {
                    $diffs[] = 'Porcentaje de participación distinto al reportado.';
                }
            }

            $comparacion[] = [
                'folio' => $folio,
                'fecha' => $soft['fecha'] ?? ($asig['fecha'] ?? ($snapshot['fecha'] ?? null)),
                'cliente' => $soft['cliente'] ?? ($asig['cliente'] ?? ($snapshot['cliente'] ?? '')),
                'cod_vendedor_softland' => $soft['cod_vendedor_softland'] ?? '',
                'vendedor_softland' => $soft['vendedor_softland'] ?? '',
                'vendedor_asignador' => $asig['vendedor_asignador'] ?? '',
                'vendedor_asignado' => $asig['vendedor_asignado'] ?? ($snapshot['vendedor_asignado'] ?? ''),
                'porcentaje_participacion' => (float)($asig['porcentaje'] ?? ($snapshot['porcentaje_participacion'] ?? 0)),
                'monto_asignado' => (float)($asig['monto_asignado'] ?? ($snapshot['monto_asignado'] ?? 0)),
                'total_softland' => (float)($soft['total_softland'] ?? 0),
                'existe_softland' => (bool)$soft,
                'existe_asignacion' => (bool)$asig,
                'incluido_en_reporte' => (bool)$repItem,
                'reporte_id' => $reporte['id'] ?? null,
                'estado_reporte' => $reporte['estado'] ?? null,
                'diferencias' => $diffs,
                'total_reportes' => count($repRows),
                'reporte_confirmado_at' => $reporte['confirmado_at'] ?? null,
            ];
        }

        $resumen = [
            'folios_softland_compartidos' => count($softlandByFolio),
            'folios_asignados' => count($asignacionesByFolio),
            'folios_reportados' => count($reportesByFolio),
            'folios_faltantes_asignacion' => count(array_filter($comparacion, fn(array $item): bool => !empty($item['existe_softland']) && empty($item['existe_asignacion']))),
            'folios_faltantes_reporte' => count(array_filter($comparacion, fn(array $item): bool => !empty($item['existe_asignacion']) && empty($item['incluido_en_reporte']))),
            'reportes_pendientes_rrhh' => count(array_filter($reportes, fn(array $item): bool => ($item['estado'] ?? '') === 'confirmado_vendedor')),
            'reportes_validados' => count(array_filter($reportes, fn(array $item): bool => ($item['estado'] ?? '') === 'validado_rrhh')),
            'reportes_rechazados' => count(array_filter($reportes, fn(array $item): bool => ($item['estado'] ?? '') === 'rechazado_rrhh')),
            'diferencias_detectadas' => count(array_filter($comparacion, fn(array $item): bool => !empty($item['diferencias']))),
        ];

        return compact('comparacion', 'resumen', 'softlandByFolio', 'asignaciones', 'reportes');
    }

    public function revisionVentasCompartidas(array $payload, array $query): array
    {
        $this->assertRrhh($payload);
        $periodo = $this->periodoRevision($query);
        $vendedorAsignadorId = !empty($query['vendedor_asignador_id']) ? $this->parseId($query['vendedor_asignador_id'], 'Vendedor asignador') : null;
        $vendedorAsignadoId = !empty($query['vendedor_asignado_id']) ? $this->parseId($query['vendedor_asignado_id'], 'Vendedor asignado') : null;
        $estado = isset($query['estado']) ? trim((string)$query['estado']) : null;
        $folio = isset($query['folio']) ? trim((string)$query['folio']) : null;
        $cliente = isset($query['cliente']) ? trim((string)$query['cliente']) : null;
        $soloDiferencias = $this->parseBool($query['solo_diferencias'] ?? false);

        $codigosAsignador = $this->obtenerCodigosVendedorPorUsuarioId($vendedorAsignadorId);
        $codigosAsignado = $this->obtenerCodigosVendedorPorUsuarioId($vendedorAsignadoId);
        $reportes = $this->listarReportes([
            'anio' => $periodo['anio'],
            'mes' => $periodo['mes'],
            'estado' => $estado,
            'vendedor_usuario_id' => $vendedorAsignadoId,
            'folio' => $folio,
        ]);
        $foliosSoftland = $this->listarFoliosSoftlandCompartidos($periodo['anio'], $periodo['mes']);
        $asignaciones = $this->listarFoliosAsignadosRevision($periodo['anio'], $periodo['mes'], $codigosAsignador, $codigosAsignado, $folio);
        if ($cliente !== '') {
            $foliosSoftland = array_values(array_filter($foliosSoftland, fn(array $row): bool => str_contains(mb_strtolower($row['cliente']), mb_strtolower($cliente))));
        }

        $comparacion = $this->compararRevision($foliosSoftland, $asignaciones, $reportes);
        $comparacionFiltrada = $soloDiferencias
            ? array_values(array_filter($comparacion['comparacion'], fn(array $item): bool => !empty($item['diferencias'])))
            : $comparacion['comparacion'];

        return [
            'ok' => true,
            'periodo' => [
                'anio' => $periodo['anio'],
                'mes' => $periodo['mes'],
                'label' => $this->formatPeriodoLabel($periodo['anio'], $periodo['mes']),
            ],
            'codigos_compartidos' => $this->softlandCodes(),
            'resumen' => [
                ...$comparacion['resumen'],
                'folios_softland' => $comparacion['resumen']['folios_softland_compartidos'],
            ],
            'folios_softland_compartidos' => $foliosSoftland,
            'folios_softland' => $foliosSoftland,
            'folios_tipo_c' => $foliosSoftland,
            'folios_asignados' => $asignaciones,
            'reportes_confirmados' => $reportes,
            'comparacion' => $comparacionFiltrada,
            'vendedores_compartidos' => [],
        ];
    }

    public function validarReporteCompartido(array $payload, int $id, array $body): array
    {
        $this->assertRrhh($payload);
        $comentario = $this->normalizeText($body['comentario_rrhh'] ?? '');
        $usuarioId = (int)($payload['id'] ?? $payload['sub'] ?? 0);
        $reporte = $this->db->fetchOne(
            'SELECT * FROM reporte_venta_compartida_confirmacion WHERE id = ? LIMIT 1',
            [$id]
        );
        if (!$reporte) {
            throw new RuntimeException('Reporte compartido no encontrado', 404);
        }
        if (($reporte['estado'] ?? '') === 'validado_rrhh') {
            throw new RuntimeException('Este reporte ya fue validado.', 409);
        }
        if (($reporte['estado'] ?? '') === 'rechazado_rrhh') {
            throw new RuntimeException('Este reporte ya fue rechazado.', 409);
        }

        $stmt = $this->db->mysql()->prepare(
            'UPDATE reporte_venta_compartida_confirmacion
             SET estado = ?, comentario_rrhh = ?, motivo_rechazo = NULL, revisado_por = ?, revisado_at = NOW(), rechazado_por = NULL, rechazado_at = NULL
             WHERE id = ?'
        );
        $stmt->execute(['validado_rrhh', $comentario !== '' ? $comentario : null, $usuarioId, $id]);

        if (!empty($reporte['vendedor_usuario_id'])) {
            $periodo = trim(($reporte['periodo_label'] ?? '') ?: ($this->formatPeriodoLabel((int)$reporte['anio'], (int)$reporte['mes'])));
            $this->notifyUser(
                (int)$reporte['vendedor_usuario_id'],
                'reporte_compartido_validado',
                'Reporte de ventas compartidas validado',
                'RRHH validó tu reporte de ventas compartidas de ' . $periodo . '.',
                (int)$reporte['mes'],
                (int)$reporte['anio'],
                (string)$reporte['id']
            );
        }

        return ['ok' => true, 'message' => 'Reporte validado correctamente'];
    }

    public function rechazarReporteCompartido(array $payload, int $id, array $body): array
    {
        $this->assertRrhh($payload);
        $motivo = $this->normalizeText($body['motivo_rechazo'] ?? ($body['comentario_rrhh'] ?? ''));
        if (mb_strlen($motivo) < 5) {
            throw new RuntimeException('Debes indicar el motivo del rechazo.', 400);
        }
        $usuarioId = (int)($payload['id'] ?? $payload['sub'] ?? 0);
        $reporte = $this->db->fetchOne(
            'SELECT * FROM reporte_venta_compartida_confirmacion WHERE id = ? LIMIT 1',
            [$id]
        );
        if (!$reporte) {
            throw new RuntimeException('Reporte compartido no encontrado', 404);
        }
        if (($reporte['estado'] ?? '') === 'rechazado_rrhh') {
            throw new RuntimeException('Este reporte ya fue rechazado.', 409);
        }
        if (($reporte['estado'] ?? '') === 'validado_rrhh') {
            throw new RuntimeException('Este reporte ya fue validado.', 409);
        }

        $stmt = $this->db->mysql()->prepare(
            'UPDATE reporte_venta_compartida_confirmacion
             SET estado = ?, comentario_rrhh = NULL, motivo_rechazo = ?, revisado_por = NULL, revisado_at = NULL, rechazado_por = ?, rechazado_at = NOW()
             WHERE id = ?'
        );
        $stmt->execute(['rechazado_rrhh', $motivo, $usuarioId, $id]);

        if (!empty($reporte['vendedor_usuario_id'])) {
            $periodo = trim(($reporte['periodo_label'] ?? '') ?: ($this->formatPeriodoLabel((int)$reporte['anio'], (int)$reporte['mes'])));
            $this->notifyUser(
                (int)$reporte['vendedor_usuario_id'],
                'reporte_compartido_rechazado',
                'Reporte de ventas compartidas rechazado',
                'RRHH rechazó tu reporte de ventas compartidas de ' . $periodo . '. Motivo: ' . $motivo,
                (int)$reporte['mes'],
                (int)$reporte['anio'],
                (string)$reporte['id']
            );
        }

        return ['ok' => true, 'message' => 'Reporte rechazado correctamente'];
    }

    public function route(array $payload, string $method, string $path, array $query, array $body): array
    {
        if ($method === 'GET' && $path === '/confirmaciones') return $this->confirmaciones($payload, $query);
        if ($method === 'GET' && preg_match('#^/confirmaciones/(\d+)/pdf$#', $path, $m)) return $this->confirmacionPdf($payload, (int)$m[1]);
        if ($method === 'GET' && $path === '/reportes-compartidos') return $this->reportesCompartidos($payload, $query);
        if ($method === 'GET' && preg_match('#^/reportes-compartidos/(\d+)$#', $path, $m)) return $this->reporteCompartido($payload, (int)$m[1]);
        if ($method === 'GET' && $path === '/ventas-compartidas/revision') return $this->revisionVentasCompartidas($payload, $query);
        if ($method === 'PATCH' && preg_match('#^/reportes-compartidos/(\d+)/validar$#', $path, $m)) return $this->validarReporteCompartido($payload, (int)$m[1], $body);
        if ($method === 'PATCH' && preg_match('#^/reportes-compartidos/(\d+)/rechazar$#', $path, $m)) return $this->rechazarReporteCompartido($payload, (int)$m[1], $body);
        throw new RuntimeException('Ruta RRHH no encontrada', 404);
    }
}
