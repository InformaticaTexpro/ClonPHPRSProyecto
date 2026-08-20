<?php
declare(strict_types=1);

final class LaboratorioService
{
    public function __construct(private Database $db)
    {
    }

    public function route(array $payload, string $method, string $path, array $query, array $body): array
    {
        $this->assertModuleAccess($payload);

        if ($method === 'GET' && ($path === '/' || $path === '/config')) {
            return $this->config($payload, $query);
        }
        if ($method === 'GET' && $path === '/resumen') {
            return $this->resumen($payload, $query);
        }
        if ($method === 'GET' && $path === '/parametros') {
            return $this->listarParametros($payload, $query);
        }
        if ($method === 'POST' && $path === '/parametros') {
            return $this->guardarParametro($payload, $body);
        }
        if ($method === 'PUT' && preg_match('#^/parametros/(\d+)$#', $path, $m)) {
            return $this->guardarParametro($payload, $body, (int)$m[1]);
        }
        if ($method === 'PATCH' && preg_match('#^/parametros/(\d+)/activar$#', $path, $m)) {
            return $this->cambiarEstadoParametro($payload, (int)$m[1], true);
        }
        if ($method === 'PATCH' && preg_match('#^/parametros/(\d+)/desactivar$#', $path, $m)) {
            return $this->cambiarEstadoParametro($payload, (int)$m[1], false);
        }
        if ($method === 'DELETE' && preg_match('#^/parametros/(\d+)$#', $path, $m)) {
            return $this->cambiarEstadoParametro($payload, (int)$m[1], false);
        }
        if ($method === 'GET' && $path === '/solicitudes') {
            return $this->listarSolicitudes($payload, $query);
        }
        if ($method === 'GET' && preg_match('#^/solicitudes/(\d+)$#', $path, $m)) {
            return $this->verSolicitud((int)$m[1]);
        }
        if ($method === 'POST' && $path === '/solicitudes') {
            return $this->guardarSolicitud($payload, $body);
        }
        if ($method === 'PUT' && preg_match('#^/solicitudes/(\d+)$#', $path, $m)) {
            return $this->guardarSolicitud($payload, $body, (int)$m[1]);
        }
        if ($method === 'PATCH' && preg_match('#^/solicitudes/(\d+)/anular$#', $path, $m)) {
            return $this->anularSolicitud($payload, (int)$m[1], $body);
        }
        if ($method === 'GET' && $path === '/auditoria') {
            return $this->auditoria($query);
        }

        throw new RuntimeException('Ruta de laboratorio no encontrada', 404);
    }

    private function assertModuleAccess(array $payload): void
    {
        if ($this->canAccessModule($payload)) {
            return;
        }

        throw new RuntimeException('Acceso denegado al módulo de laboratorio', 403);
    }

    private function canAccessModule(array $payload): bool
    {
        if ((bool)($payload['is_admin'] ?? false)) {
            return true;
        }

        $area = $this->normalizeKey($payload['area'] ?? '');
        if ($area === 'laboratorio') {
            return true;
        }

        $perfiles = $payload['perfiles'] ?? [];
        if (is_array($perfiles)) {
            foreach ($perfiles as $perfil) {
                if ($this->normalizeKey($perfil['codigo'] ?? '') === 'laboratorio') {
                    return true;
                }
            }
        }

        $menus = $payload['menus'] ?? [];
        if (is_array($menus)) {
            foreach ($menus as $menu) {
                if ($this->normalizeKey($menu['codigo'] ?? '') === 'laboratorio_ingreso_muestras') {
                    return true;
                }
            }
        }

        return false;
    }

    private function canManageCatalog(array $payload): bool
    {
        if ((bool)($payload['is_admin'] ?? false)) {
            return true;
        }

        $area = $this->normalizeKey($payload['area'] ?? '');
        if ($area === 'laboratorio') {
            return true;
        }

        $perfiles = $payload['perfiles'] ?? [];
        if (is_array($perfiles)) {
            foreach ($perfiles as $perfil) {
                if ($this->normalizeKey($perfil['codigo'] ?? '') === 'laboratorio') {
                    return true;
                }
            }
        }

        return false;
    }

    private function normalizeText(mixed $value): string
    {
        return trim((string)$value);
    }

    private function normalizeCode(mixed $value): string
    {
        $text = $this->normalizeText($value);
        return $text === '' ? '' : mb_strtoupper(preg_replace('/\s+/', '', $text) ?? $text);
    }

    private function normalizeKey(mixed $value): string
    {
        $text = $this->normalizeText($value);
        $text = mb_strtolower($text);
        $text = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $text) ?: $text;
        $text = preg_replace('/\s+/', '-', $text) ?? $text;
        $text = preg_replace('/[^a-z0-9-]/', '', $text) ?? $text;
        return trim($text, '-');
    }

    private function normalizeMoney(mixed $value): float
    {
        if (is_numeric($value)) {
            return (float)$value;
        }

        $text = str_replace(['$', ' ', '.'], '', (string)$value);
        $text = str_replace(',', '.', $text);
        return is_numeric($text) ? (float)$text : 0.0;
    }

    private function currentUserId(array $payload): int
    {
        $id = (int)($payload['sub'] ?? $payload['id'] ?? 0);
        if ($id <= 0) {
            throw new RuntimeException('Token inválido.', 401);
        }
        return $id;
    }

    private function currentUserName(array $payload): string
    {
        return $this->normalizeText($payload['nombre'] ?? $payload['email'] ?? 'Usuario');
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

    private function parsePeriod(array $query): array
    {
        return Security::validate_mes_anio($query['mes'] ?? null, $query['anio'] ?? null);
    }

    private function monthRange(int $anio, int $mes): array
    {
        $desde = sprintf('%04d-%02d-01', $anio, $mes);
        $hasta = (new DateTimeImmutable($desde))->modify('first day of next month')->format('Y-m-d');
        return [$desde, $hasta];
    }

    private function periodLabel(int $anio, int $mes): string
    {
        $meses = [
            1 => 'Enero', 2 => 'Febrero', 3 => 'Marzo', 4 => 'Abril',
            5 => 'Mayo', 6 => 'Junio', 7 => 'Julio', 8 => 'Agosto',
            9 => 'Septiembre', 10 => 'Octubre', 11 => 'Noviembre', 12 => 'Diciembre',
        ];
        return ($meses[$mes] ?? 'Mes') . ' ' . $anio;
    }

    private function laboratorioAuditoriaTimestampColumn(PDO $pdo): ?string
    {
        $dbNameRow = $this->db->fetchOne('SELECT DATABASE() AS db_name') ?: [];
        $dbName = $this->normalizeText($dbNameRow['db_name'] ?? '');
        if ($dbName === '') {
            return null;
        }

        $rows = $this->db->fetchAll(
            'SELECT COLUMN_NAME
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = ?
               AND TABLE_NAME = "laboratorio_auditoria"
               AND COLUMN_NAME IN ("creado_en", "created_at")
             ORDER BY FIELD(COLUMN_NAME, "creado_en", "created_at")',
            [$dbName]
        );

        foreach ($rows as $row) {
            $column = $this->normalizeText($row['COLUMN_NAME'] ?? '');
            if ($column !== '') {
                return $column;
            }
        }

        return null;
    }

    private function audit(PDO $pdo, array $payload, string $accion, string $entidad, ?int $entidadId, array $detalle = []): void
    {
        $timestampColumn = $this->laboratorioAuditoriaTimestampColumn($pdo);
        $columns = 'usuario_id, usuario_nombre, accion, entidad, entidad_id, detalle';
        $values = '?, ?, ?, ?, ?, ?';
        $params = [
            $this->currentUserId($payload),
            $this->currentUserName($payload),
            $accion,
            $entidad,
            $entidadId,
            json_encode($detalle, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ];

        if ($timestampColumn !== null) {
            $columns .= ', ' . $timestampColumn;
            $values .= ', NOW()';
        }

        $pdo->prepare(
            'INSERT INTO laboratorio_auditoria (' . $columns . ')
             VALUES (' . $values . ')'
        )->execute($params);
    }

    private function mapParametro(array $row): array
    {
        return [
            'id' => (int)($row['id'] ?? 0),
            'nombre' => $this->normalizeText($row['nombre'] ?? ''),
            'valor_ensayo' => (float)($row['valor_ensayo'] ?? 0),
            'activo' => (bool)($row['activo'] ?? 0),
            'creado_por' => isset($row['creado_por']) ? (int)$row['creado_por'] : null,
            'actualizado_por' => isset($row['actualizado_por']) ? (int)$row['actualizado_por'] : null,
            'created_at' => $row['created_at'] ?? null,
            'updated_at' => $row['updated_at'] ?? null,
            'total_usos' => (int)($row['total_usos'] ?? 0),
        ];
    }

    private function mapSolicitud(array $row): array
    {
        return [
            'id' => (int)($row['id'] ?? 0),
            'numero_solicitud' => $this->normalizeText($row['numero_solicitud'] ?? ''),
            'fecha_ingreso' => $this->normalizeText($row['fecha_ingreso'] ?? ''),
            'fecha_formato' => $this->formatDate($row['fecha_ingreso'] ?? ''),
            'vendedor_nombre' => $this->normalizeText($row['vendedor_nombre'] ?? ''),
            'vendedor_codigo' => $this->normalizeCode($row['vendedor_codigo'] ?? ''),
            'numero_muestras' => (int)($row['numero_muestras'] ?? 0),
            'valor_unitario' => (float)($row['valor_unitario'] ?? 0),
            'total' => (float)($row['total'] ?? 0),
            'estado' => $this->normalizeText($row['estado'] ?? ''),
            'observacion' => $this->normalizeText($row['observacion'] ?? ''),
            'registrado_por' => isset($row['registrado_por']) ? (int)$row['registrado_por'] : null,
            'registrado_por_nombre' => $this->normalizeText($row['registrado_por_nombre'] ?? ''),
            'created_at' => $row['created_at'] ?? null,
            'updated_at' => $row['updated_at'] ?? null,
        ];
    }

    private function mapSolicitudLinea(array $row): array
    {
        return [
            'id' => (int)($row['id'] ?? 0),
            'solicitud_id' => (int)($row['solicitud_id'] ?? 0),
            'parametro_id' => isset($row['parametro_id']) ? (int)$row['parametro_id'] : null,
            'parametro_nombre' => $this->normalizeText($row['parametro_nombre'] ?? ''),
            'valor_ensayo' => (float)($row['valor_ensayo'] ?? 0),
            'cantidad_muestras' => (int)($row['cantidad_muestras'] ?? 0),
            'subtotal' => (float)($row['subtotal'] ?? 0),
            'created_at' => $row['created_at'] ?? null,
            'updated_at' => $row['updated_at'] ?? null,
        ];
    }

    private function mapAuditoria(array $row): array
    {
        $fecha = $row['creado_en'] ?? $row['created_at'] ?? null;
        return [
            'id' => (int)($row['id'] ?? 0),
            'usuario_id' => isset($row['usuario_id']) ? (int)$row['usuario_id'] : null,
            'usuario_nombre' => $this->normalizeText($row['usuario_nombre'] ?? ''),
            'accion' => $this->normalizeText($row['accion'] ?? ''),
            'entidad' => $this->normalizeText($row['entidad'] ?? ''),
            'entidad_id' => isset($row['entidad_id']) ? (int)$row['entidad_id'] : null,
            'detalle' => $this->normalizeText($row['detalle'] ?? ''),
            'creado_en' => $fecha,
            'fecha_formato' => $this->formatDateTime($fecha),
        ];
    }

    private function formatDate(mixed $value): string
    {
        $text = $this->normalizeText($value);
        if ($text === '') {
            return '—';
        }

        $dt = DateTimeImmutable::createFromFormat('Y-m-d', $text);
        return $dt ? $dt->format('d-m-Y') : $text;
    }

    private function formatDateTime(mixed $value): string
    {
        $text = $this->normalizeText($value);
        if ($text === '') {
            return '—';
        }

        try {
            return (new DateTimeImmutable($text))->format('d-m-Y H:i');
        } catch (Throwable) {
            return $text;
        }
    }

    private function loadVendorName(PDO $pdo, string $codigo, array $payload): string
    {
        $row = $this->db->fetchOne(
            'SELECT u.nombre
             FROM usuario_vendedor uv
             INNER JOIN usuario u ON u.id = uv.usuario_id
             WHERE TRIM(uv.cod_vendedor) = ?
             ORDER BY uv.tipo ASC, u.nombre ASC
             LIMIT 1',
            [$codigo]
        );

        $nombre = $this->normalizeText($row['nombre'] ?? '');
        if ($nombre !== '') {
            return $nombre;
        }

        $fallback = $this->currentUserName($payload);
        return $fallback !== '' ? $fallback : $codigo;
    }

    private function ensureSolicitudNumero(PDO $pdo, string $numero, string $fechaIngreso): string
    {
        $numero = $this->normalizeText($numero);
        if ($numero !== '') {
            return $numero;
        }

        $fecha = DateTimeImmutable::createFromFormat('Y-m-d', $fechaIngreso) ?: new DateTimeImmutable('now');
        $prefix = 'LAB-' . $fecha->format('Ym');
        $row = $this->db->fetchOne(
            'SELECT COUNT(*) AS total FROM laboratorio_solicitud WHERE numero_solicitud LIKE ?',
            [$prefix . '-%']
        );

        return sprintf('%s-%04d', $prefix, ((int)($row['total'] ?? 0)) + 1);
    }

    private function parseSolicitudItems(PDO $pdo, array $items, int $numeroMuestras): array
    {
        $lineas = [];
        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }

            $parametroId = (int)($item['parametro_id'] ?? $item['id'] ?? 0);
            if ($parametroId <= 0) {
                continue;
            }

            $parametro = $this->db->fetchOne(
                'SELECT id, nombre, valor_ensayo, activo
                 FROM laboratorio_parametro
                 WHERE id = ?
                 LIMIT 1',
                [$parametroId]
            );

            if (!$parametro || !(bool)($parametro['activo'] ?? false)) {
                continue;
            }

            $cantidad = (int)($item['cantidad_muestras'] ?? $numeroMuestras);
            if ($cantidad <= 0) {
                $cantidad = $numeroMuestras;
            }

            $valor = (float)($parametro['valor_ensayo'] ?? 0);
            $lineas[] = [
                'parametro_id' => (int)$parametro['id'],
                'parametro_nombre' => $this->normalizeText($parametro['nombre'] ?? ''),
                'valor_ensayo' => $valor,
                'cantidad_muestras' => $cantidad,
                'subtotal' => $valor * $cantidad,
            ];
        }

        if (!$lineas) {
            throw new RuntimeException('Debes seleccionar al menos un parámetro.', 400);
        }

        return $lineas;
    }

    private function loadSolicitud(PDO $pdo, int $id): ?array
    {
        $row = $this->db->fetchOne(
            'SELECT id, numero_solicitud, fecha_ingreso, vendedor_nombre, vendedor_codigo, numero_muestras, valor_unitario, total, estado, observacion, registrado_por, registrado_por_nombre, created_at, updated_at
             FROM laboratorio_solicitud
             WHERE id = ?
             LIMIT 1',
            [$id]
        );

        if (!$row) {
            return null;
        }

        $solicitud = $this->mapSolicitud($row);
        $lineas = $this->db->fetchAll(
            'SELECT id, solicitud_id, parametro_id, parametro_nombre, valor_ensayo, cantidad_muestras, subtotal, created_at, updated_at
             FROM laboratorio_solicitud_parametro
             WHERE solicitud_id = ?
             ORDER BY id ASC',
            [$id]
        );
        $solicitud['parametros'] = array_map(fn(array $linea): array => $this->mapSolicitudLinea($linea), $lineas);
        $solicitud['parametros_count'] = count($solicitud['parametros']);
        $solicitud['parametros_texto'] = implode(' · ', array_map(static fn(array $linea): string => $linea['parametro_nombre'], $solicitud['parametros']));

        return $solicitud;
    }

    private function listarParametrosInternos(bool $includeInactive = false, array $query = []): array
    {
        $sql = 'SELECT p.id, p.nombre, p.valor_ensayo, p.activo, p.creado_por, p.actualizado_por, p.created_at, p.updated_at, COUNT(sp.id) AS total_usos
                FROM laboratorio_parametro p
                LEFT JOIN laboratorio_solicitud_parametro sp ON sp.parametro_id = p.id';
        $params = [];
        $where = [];
        if (!$includeInactive) {
            $where[] = 'p.activo = 1';
        } elseif (isset($query['activo']) && $query['activo'] !== '') {
            $where[] = 'p.activo = ?';
            $params[] = (int)$query['activo'] ? 1 : 0;
        }

        $search = mb_strtolower($this->normalizeText($query['search'] ?? $query['q'] ?? ''));
        if ($search !== '') {
            $where[] = '(LOWER(p.nombre) LIKE ? OR CAST(p.valor_ensayo AS CHAR) LIKE ?)';
            $params[] = '%' . $search . '%';
            $params[] = '%' . $search . '%';
        }

        if ($where) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }

        $sql .= ' GROUP BY p.id, p.nombre, p.valor_ensayo, p.activo, p.creado_por, p.actualizado_por, p.created_at, p.updated_at
                  ORDER BY p.activo DESC, p.nombre ASC';

        $rows = $this->db->fetchAll($sql, $params);
        return array_map(fn(array $row): array => $this->mapParametro($row), $rows);
    }

    private function solicitudesPeriodo(array $query): array
    {
        $periodo = $this->parsePeriod($query);
        [$desde, $hasta] = $this->monthRange($periodo['anio'], $periodo['mes']);
        $rows = $this->db->fetchAll(
            'SELECT
                s.id,
                s.numero_solicitud,
                s.fecha_ingreso,
                s.vendedor_nombre,
                s.vendedor_codigo,
                s.numero_muestras,
                s.valor_unitario,
                s.total,
                s.estado,
                s.observacion,
                s.registrado_por,
                s.registrado_por_nombre,
                s.created_at,
                s.updated_at,
                COUNT(sp.id) AS parametros_count,
                GROUP_CONCAT(sp.parametro_nombre ORDER BY sp.id SEPARATOR " · ") AS parametros_texto
             FROM laboratorio_solicitud s
             LEFT JOIN laboratorio_solicitud_parametro sp ON sp.solicitud_id = s.id
             WHERE s.fecha_ingreso >= ?
               AND s.fecha_ingreso < ?
             GROUP BY
                s.id, s.numero_solicitud, s.fecha_ingreso, s.vendedor_nombre, s.vendedor_codigo,
                s.numero_muestras, s.valor_unitario, s.total, s.estado, s.observacion,
                s.registrado_por, s.registrado_por_nombre, s.created_at, s.updated_at
             ORDER BY s.fecha_ingreso DESC, s.id DESC',
            [$desde, $hasta]
        );

        $items = array_map(function (array $row): array {
            $mapped = $this->mapSolicitud($row);
            $mapped['parametros_count'] = (int)($row['parametros_count'] ?? 0);
            $mapped['parametros_texto'] = $this->normalizeText($row['parametros_texto'] ?? '');
            return $mapped;
        }, $rows);

        $estado = $this->normalizeKey($query['estado'] ?? '');
        $search = mb_strtolower($this->normalizeText($query['search'] ?? $query['q'] ?? ''));
        $codVendedor = $this->normalizeCode($query['cod_vendedor'] ?? '');

        return array_values(array_filter($items, static function (array $row) use ($estado, $search, $codVendedor): bool {
            if ($estado !== '' && $estado !== 'todos') {
                $rowState = mb_strtolower(str_replace('_', '-', (string)$row['estado']));
                if ($rowState !== $estado) {
                    return false;
                }
            }

            if ($codVendedor !== '' && $row['vendedor_codigo'] !== $codVendedor) {
                return false;
            }

            if ($search === '') {
                return true;
            }

            $haystack = mb_strtolower(implode(' ', [
                $row['numero_solicitud'],
                $row['vendedor_nombre'],
                $row['vendedor_codigo'],
                $row['observacion'],
                $row['parametros_texto'],
            ]));

            return str_contains($haystack, $search);
        }));
    }

    private function calcularTotalesPeriodo(array $solicitudes): array
    {
        $activas = array_values(array_filter($solicitudes, static fn(array $row): bool => strtoupper((string)$row['estado']) !== 'ANULADA'));
        $anuladas = count($solicitudes) - count($activas);

        $totalSolicitudes = count($activas);
        $totalMuestras = array_sum(array_map(static fn(array $row): int => (int)$row['numero_muestras'], $activas));
        $totalMonto = array_sum(array_map(static fn(array $row): float => (float)$row['total'], $activas));
        $totalUnitario = array_sum(array_map(static fn(array $row): float => (float)$row['valor_unitario'], $activas));
        $parametros = [];

        return [
            'total_solicitudes' => $totalSolicitudes,
            'total_muestras' => $totalMuestras,
            'total_monto' => round($totalMonto, 2),
            'valor_promedio_unitario' => $totalSolicitudes > 0 ? round($totalUnitario / $totalSolicitudes, 2) : 0,
            'solicitudes_anuladas' => $anuladas,
            'parametros_distintos' => count($parametros),
        ];
    }

    private function resumenTotales(array $query): array
    {
        $periodo = $this->parsePeriod($query);
        [$desde, $hasta] = $this->monthRange($periodo['anio'], $periodo['mes']);

        $totales = $this->db->fetchOne(
            'SELECT
                COUNT(*) AS total_solicitudes,
                COALESCE(SUM(numero_muestras), 0) AS total_muestras,
                COALESCE(SUM(total), 0) AS total_monto,
                COALESCE(AVG(valor_unitario), 0) AS valor_promedio_unitario
             FROM laboratorio_solicitud
             WHERE fecha_ingreso >= ?
               AND fecha_ingreso < ?
               AND estado <> "ANULADA"',
            [$desde, $hasta]
        ) ?: [];

        $anuladas = $this->db->fetchOne(
            'SELECT COUNT(*) AS total_anuladas
             FROM laboratorio_solicitud
             WHERE fecha_ingreso >= ?
               AND fecha_ingreso < ?
               AND estado = "ANULADA"',
            [$desde, $hasta]
        ) ?: [];

        $vendedores = $this->db->fetchAll(
            'SELECT
                COALESCE(vendedor_codigo, "") AS vendedor_codigo,
                vendedor_nombre,
                COUNT(*) AS solicitudes,
                COALESCE(SUM(numero_muestras), 0) AS muestras,
                COALESCE(SUM(total), 0) AS total,
                COALESCE(AVG(valor_unitario), 0) AS valor_unitario
             FROM laboratorio_solicitud
             WHERE fecha_ingreso >= ?
               AND fecha_ingreso < ?
               AND estado <> "ANULADA"
             GROUP BY vendedor_codigo, vendedor_nombre
             ORDER BY total DESC, vendedor_nombre ASC',
            [$desde, $hasta]
        );

        $parametros = $this->db->fetchAll(
            'SELECT
                sp.parametro_nombre,
                COUNT(DISTINCT sp.solicitud_id) AS solicitudes,
                COALESCE(SUM(sp.cantidad_muestras), 0) AS muestras,
                COALESCE(SUM(sp.subtotal), 0) AS total,
                COALESCE(AVG(sp.valor_ensayo), 0) AS valor_ensayo
             FROM laboratorio_solicitud_parametro sp
             INNER JOIN laboratorio_solicitud s ON s.id = sp.solicitud_id
             WHERE s.fecha_ingreso >= ?
               AND s.fecha_ingreso < ?
               AND s.estado <> "ANULADA"
             GROUP BY sp.parametro_nombre
             ORDER BY total DESC, sp.parametro_nombre ASC',
            [$desde, $hasta]
        );

        return [
            'ok' => true,
            'periodo' => [
                'mes' => $periodo['mes'],
                'anio' => $periodo['anio'],
                'etiqueta' => $this->periodLabel($periodo['anio'], $periodo['mes']),
            ],
            'resumen' => [
                'total_solicitudes' => (int)($totales['total_solicitudes'] ?? 0),
                'total_muestras' => (int)($totales['total_muestras'] ?? 0),
                'total_monto' => (float)($totales['total_monto'] ?? 0),
                'valor_promedio_unitario' => (float)($totales['valor_promedio_unitario'] ?? 0),
                'solicitudes_anuladas' => (int)($anuladas['total_anuladas'] ?? 0),
                'vendedores' => count($vendedores),
                'parametros_distintos' => count($parametros),
            ],
            'por_vendedor' => array_map(static function (array $row): array {
                return [
                    'vendedor_codigo' => trim((string)($row['vendedor_codigo'] ?? '')),
                    'vendedor_nombre' => trim((string)($row['vendedor_nombre'] ?? '')),
                    'solicitudes' => (int)($row['solicitudes'] ?? 0),
                    'muestras' => (int)($row['muestras'] ?? 0),
                    'total' => (float)($row['total'] ?? 0),
                    'valor_unitario' => (float)($row['valor_unitario'] ?? 0),
                ];
            }, $vendedores),
            'por_parametro' => array_map(static function (array $row): array {
                return [
                    'parametro_nombre' => trim((string)($row['parametro_nombre'] ?? '')),
                    'solicitudes' => (int)($row['solicitudes'] ?? 0),
                    'muestras' => (int)($row['muestras'] ?? 0),
                    'total' => (float)($row['total'] ?? 0),
                    'valor_ensayo' => (float)($row['valor_ensayo'] ?? 0),
                ];
            }, $parametros),
        ];
    }

    public function config(array $payload, array $query): array
    {
        $periodo = $this->parsePeriod($query);
        [$desde, $hasta] = $this->monthRange($periodo['anio'], $periodo['mes']);
        $count = $this->db->fetchOne(
            'SELECT COUNT(*) AS total FROM laboratorio_solicitud WHERE fecha_ingreso >= ? AND fecha_ingreso < ?',
            [$desde, $hasta]
        ) ?: [];

        $config = [
            'usuario' => [
                'id' => $this->currentUserId($payload),
                'nombre' => $this->currentUserName($payload),
                'area' => $this->normalizeText($payload['area'] ?? ''),
                'is_admin' => (bool)($payload['is_admin'] ?? false),
            ],
            'vendedores' => array_values(array_map(static function (array $item): array {
                return [
                    'cod_vendedor' => trim((string)($item['cod_vendedor'] ?? '')),
                    'tipo' => strtoupper(trim((string)($item['tipo'] ?? ''))),
                ];
            }, is_array($payload['vendedores'] ?? null) ? $payload['vendedores'] : [])),
            'parametros' => $this->listarParametrosInternos(false, $query),
            'siguiente_numero_solicitud' => sprintf(
                'LAB-%04d%02d-%04d',
                $periodo['anio'],
                $periodo['mes'],
                ((int)($count['total'] ?? 0)) + 1
            ),
            'puede_administrar' => $this->canManageCatalog($payload),
            'periodo' => [
                'mes' => $periodo['mes'],
                'anio' => $periodo['anio'],
                'etiqueta' => $this->periodLabel($periodo['anio'], $periodo['mes']),
            ],
        ];

        return ['ok' => true, 'data' => $config];
    }

    public function resumen(array $payload, array $query): array
    {
        return $this->resumenTotales($query);
    }

    public function listarParametros(array $payload, array $query): array
    {
        return [
            'ok' => true,
            'data' => $this->listarParametrosInternos($this->canManageCatalog($payload), $query),
        ];
    }

    public function guardarParametro(array $payload, array $body, ?int $id = null): array
    {
        if (!$this->canManageCatalog($payload)) {
            throw new RuntimeException('Solo usuarios autorizados pueden administrar parámetros.', 403);
        }

        $nombre = $this->normalizeText($body['nombre'] ?? '');
        $valor = $this->normalizeMoney($body['valor_ensayo'] ?? $body['valor'] ?? 0);
        $activo = array_key_exists('activo', $body) ? (bool)$body['activo'] : true;
        if ($nombre === '') {
            throw new RuntimeException('El nombre del parámetro es obligatorio.', 400);
        }
        if ($valor < 0) {
            throw new RuntimeException('El valor de ensayo no puede ser negativo.', 400);
        }

        $parametro = $this->withTransaction(function (PDO $pdo) use ($payload, $nombre, $valor, $activo, $id) {
            $duplicateSql = 'SELECT id FROM laboratorio_parametro WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?))';
            $params = [$nombre];
            if ($id !== null) {
                $duplicateSql .= ' AND id <> ?';
                $params[] = $id;
            }

            if ($this->db->fetchOne($duplicateSql . ' LIMIT 1', $params)) {
                throw new RuntimeException('Ya existe un parámetro con ese nombre.', 409);
            }

            if ($id === null) {
                $pdo->prepare(
                    'INSERT INTO laboratorio_parametro (nombre, valor_ensayo, activo, creado_por, actualizado_por, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, NOW(), NOW())'
                )->execute([
                    $nombre,
                    $valor,
                    $activo ? 1 : 0,
                    $this->currentUserId($payload),
                    $this->currentUserId($payload),
                ]);
                $newId = (int)$pdo->lastInsertId();
                $this->audit($pdo, $payload, 'PARAMETRO_CREADO', 'laboratorio_parametro', $newId, ['nombre' => $nombre]);
                return $this->db->fetchOne('SELECT * FROM laboratorio_parametro WHERE id = ? LIMIT 1', [$newId]);
            }

            if (!$this->db->fetchOne('SELECT id FROM laboratorio_parametro WHERE id = ? LIMIT 1', [$id])) {
                throw new RuntimeException('Parámetro no encontrado.', 404);
            }

            $pdo->prepare(
                'UPDATE laboratorio_parametro
                 SET nombre = ?, valor_ensayo = ?, activo = ?, actualizado_por = ?, updated_at = NOW()
                 WHERE id = ?'
            )->execute([
                $nombre,
                $valor,
                $activo ? 1 : 0,
                $this->currentUserId($payload),
                $id,
            ]);
            $this->audit($pdo, $payload, 'PARAMETRO_ACTUALIZADO', 'laboratorio_parametro', $id, ['nombre' => $nombre]);
            return $this->db->fetchOne('SELECT * FROM laboratorio_parametro WHERE id = ? LIMIT 1', [$id]);
        });

        return ['ok' => true, 'data' => $this->mapParametro($parametro ?? [])];
    }

    public function cambiarEstadoParametro(array $payload, int $id, bool $activo): array
    {
        if (!$this->canManageCatalog($payload)) {
            throw new RuntimeException('Solo usuarios autorizados pueden administrar parámetros.', 403);
        }

        $parametro = $this->withTransaction(function (PDO $pdo) use ($payload, $id, $activo) {
            if (!$this->db->fetchOne('SELECT id FROM laboratorio_parametro WHERE id = ? LIMIT 1', [$id])) {
                throw new RuntimeException('Parámetro no encontrado.', 404);
            }

            $pdo->prepare(
                'UPDATE laboratorio_parametro
                 SET activo = ?, actualizado_por = ?, updated_at = NOW()
                 WHERE id = ?'
            )->execute([
                $activo ? 1 : 0,
                $this->currentUserId($payload),
                $id,
            ]);

            $this->audit($pdo, $payload, $activo ? 'PARAMETRO_ACTIVADO' : 'PARAMETRO_DESACTIVADO', 'laboratorio_parametro', $id, ['activo' => $activo]);
            return $this->db->fetchOne('SELECT * FROM laboratorio_parametro WHERE id = ? LIMIT 1', [$id]);
        });

        return ['ok' => true, 'data' => $this->mapParametro($parametro ?? [])];
    }

    public function listarSolicitudes(array $payload, array $query): array
    {
        return [
            'ok' => true,
            'data' => $this->solicitudesPeriodo($query),
        ];
    }

    public function verSolicitud(int $id): array
    {
        $solicitud = $this->loadSolicitud($this->db->mysql(), $id);
        if (!$solicitud) {
            throw new RuntimeException('Solicitud no encontrada.', 404);
        }

        return ['ok' => true, 'data' => $solicitud];
    }

    public function guardarSolicitud(array $payload, array $body, ?int $id = null): array
    {
        $solicitud = $this->withTransaction(function (PDO $pdo) use ($payload, $body, $id) {
            $fechaIngreso = $this->normalizeText($body['fecha_ingreso'] ?? '');
            if ($fechaIngreso === '') {
                $fechaIngreso = (new DateTimeImmutable('now'))->format('Y-m-d');
            }

            $fechaObj = DateTimeImmutable::createFromFormat('Y-m-d', $fechaIngreso);
            if (!$fechaObj || $fechaObj->format('Y-m-d') !== $fechaIngreso) {
                throw new RuntimeException('La fecha de ingreso no es válida.', 400);
            }

            $numeroMuestras = (int)($body['numero_muestras'] ?? 0);
            if ($numeroMuestras <= 0) {
                throw new RuntimeException('El número de muestras debe ser mayor a cero.', 400);
            }

            $vendedorCodigo = $this->normalizeCode($body['vendedor_codigo'] ?? '');
            if ($vendedorCodigo === '') {
                throw new RuntimeException('Debes seleccionar un código de vendedor.', 400);
            }

            $vendedorNombre = $this->normalizeText($body['vendedor_nombre'] ?? '');
            if ($vendedorNombre === '') {
                $vendedorNombre = $this->loadVendorName($pdo, $vendedorCodigo, $payload);
            }

            $numeroSolicitud = $this->ensureSolicitudNumero($pdo, $body['numero_solicitud'] ?? '', $fechaIngreso);
            $estado = strtoupper($this->normalizeText($body['estado'] ?? 'INGRESADA'));
            if (!in_array($estado, ['INGRESADA', 'EN_PROCESO', 'FINALIZADA', 'ANULADA'], true)) {
                $estado = 'INGRESADA';
            }
            $observacion = $this->normalizeText($body['observacion'] ?? '');
            $lineas = $this->parseSolicitudItems($pdo, is_array($body['parametros'] ?? null) ? $body['parametros'] : [], $numeroMuestras);
            $valorUnitario = array_sum(array_map(static fn(array $linea): float => (float)$linea['valor_ensayo'], $lineas));
            $total = array_sum(array_map(static fn(array $linea): float => (float)$linea['subtotal'], $lineas));

            if ($id === null) {
                $pdo->prepare(
                    'INSERT INTO laboratorio_solicitud
                        (numero_solicitud, fecha_ingreso, vendedor_nombre, vendedor_codigo, numero_muestras, valor_unitario, total, estado, registrado_por, registrado_por_nombre, observacion, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())'
                )->execute([
                    $numeroSolicitud,
                    $fechaIngreso,
                    $vendedorNombre,
                    $vendedorCodigo,
                    $numeroMuestras,
                    $valorUnitario,
                    $total,
                    $estado,
                    $this->currentUserId($payload),
                    $this->currentUserName($payload),
                    $observacion,
                ]);
                $solicitudId = (int)$pdo->lastInsertId();
            } else {
                if (!$this->db->fetchOne('SELECT id FROM laboratorio_solicitud WHERE id = ? LIMIT 1', [$id])) {
                    throw new RuntimeException('Solicitud no encontrada.', 404);
                }

                $pdo->prepare(
                    'UPDATE laboratorio_solicitud
                     SET numero_solicitud = ?, fecha_ingreso = ?, vendedor_nombre = ?, vendedor_codigo = ?, numero_muestras = ?, valor_unitario = ?, total = ?, estado = ?, observacion = ?, updated_at = NOW()
                     WHERE id = ?'
                )->execute([
                    $numeroSolicitud,
                    $fechaIngreso,
                    $vendedorNombre,
                    $vendedorCodigo,
                    $numeroMuestras,
                    $valorUnitario,
                    $total,
                    $estado,
                    $observacion,
                    $id,
                ]);

                $pdo->prepare('DELETE FROM laboratorio_solicitud_parametro WHERE solicitud_id = ?')->execute([$id]);
                $solicitudId = $id;
            }

            $stmt = $pdo->prepare(
                'INSERT INTO laboratorio_solicitud_parametro
                    (solicitud_id, parametro_id, parametro_nombre, valor_ensayo, cantidad_muestras, subtotal, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())'
            );
            foreach ($lineas as $linea) {
                $stmt->execute([
                    $solicitudId,
                    $linea['parametro_id'],
                    $linea['parametro_nombre'],
                    $linea['valor_ensayo'],
                    $linea['cantidad_muestras'],
                    $linea['subtotal'],
                ]);
            }

            $this->audit($pdo, $payload, $id === null ? 'SOLICITUD_CREADA' : 'SOLICITUD_ACTUALIZADA', 'laboratorio_solicitud', $solicitudId, [
                'numero_solicitud' => $numeroSolicitud,
                'vendedor_codigo' => $vendedorCodigo,
                'numero_muestras' => $numeroMuestras,
                'total' => $total,
                'estado' => $estado,
            ]);

            return $this->loadSolicitud($pdo, $solicitudId);
        });

        return ['ok' => true, 'data' => $solicitud];
    }

    public function anularSolicitud(array $payload, int $id, array $body = []): array
    {
        $solicitud = $this->withTransaction(function (PDO $pdo) use ($payload, $id, $body) {
            if (!$this->db->fetchOne('SELECT id FROM laboratorio_solicitud WHERE id = ? LIMIT 1', [$id])) {
                throw new RuntimeException('Solicitud no encontrada.', 404);
            }

            $motivo = $this->normalizeText($body['motivo'] ?? $body['observacion'] ?? '');
            $pdo->prepare(
                'UPDATE laboratorio_solicitud
                 SET estado = "ANULADA",
                     observacion = CASE WHEN ? = "" THEN observacion ELSE CONCAT(COALESCE(observacion, ""), "\n", ?) END,
                     updated_at = NOW()
                 WHERE id = ?'
            )->execute([$motivo, $motivo, $id]);

            $this->audit($pdo, $payload, 'SOLICITUD_ANULADA', 'laboratorio_solicitud', $id, ['motivo' => $motivo]);
            return $this->loadSolicitud($pdo, $id);
        });

        return ['ok' => true, 'data' => $solicitud];
    }

    public function auditoria(array $query): array
    {
        $limit = max(1, min(100, (int)($query['limit'] ?? 30)));
        $timestampColumn = $this->laboratorioAuditoriaTimestampColumn($this->db->mysql()) ?? 'id';
        $rows = $this->db->fetchAll(
            'SELECT id, usuario_id, usuario_nombre, accion, entidad, entidad_id, detalle, ' . $timestampColumn . ' AS creado_en
             FROM laboratorio_auditoria
             ORDER BY ' . $timestampColumn . ' DESC, id DESC
             LIMIT ' . $limit
        );

        return [
            'ok' => true,
            'data' => array_map(fn(array $row): array => $this->mapAuditoria($row), $rows),
        ];
    }
}
