<?php
declare(strict_types=1);

final class AlertasService
{
    public function __construct(private Database $db)
    {
    }

    private function assertAuth(array $payload): void
    {
        if ((int)($payload['sub'] ?? $payload['id'] ?? 0) <= 0) {
            throw new RuntimeException('Token inválido.', 401);
        }
    }

    private function currentUserId(array $payload): int
    {
        $this->assertAuth($payload);
        return (int)($payload['sub'] ?? $payload['id'] ?? 0);
    }

    private function normalizeText(mixed $value): string
    {
        return trim((string)$value);
    }

    private function parseBool(mixed $value, bool $fallback = false): bool
    {
        if ($value === null || $value === '') return $fallback;
        if (is_bool($value)) return $value;
        if (is_int($value) || is_float($value)) return (int)$value !== 0;
        $text = mb_strtolower($this->normalizeText($value));
        if (in_array($text, ['1', 'true', 'si', 'sí', 'yes', 'y', 'on'], true)) return true;
        if (in_array($text, ['0', 'false', 'no', 'off'], true)) return false;
        return $fallback;
    }

    private function parseId(mixed $value, string $label = 'ID'): int
    {
        if (!is_numeric($value) || (int)$value <= 0) {
            throw new RuntimeException($label . ' inválido', 400);
        }
        return (int)$value;
    }

    private function toDateStr(mixed $value): ?string
    {
        if ($value === null || $value === '') return null;
        if ($value instanceof DateTimeInterface) {
            return $value->format('Y-m-d');
        }
        return substr((string)$value, 0, 10);
    }

    private function parseDate(mixed $value): ?DateTimeImmutable
    {
        $text = $this->toDateStr($value);
        if (!$text) return null;
        try {
            return new DateTimeImmutable($text);
        } catch (Throwable) {
            return null;
        }
    }

    private function daysRemaining(mixed $fechaVence): ?int
    {
        $fecha = $this->parseDate($fechaVence);
        if (!$fecha) return null;
        $today = new DateTimeImmutable('today');
        return (int)$today->diff($fecha)->format('%r%a');
    }

    private function shouldRemember(mixed $ultimoRec, string $frecuencia): bool
    {
        if (!$ultimoRec || $frecuencia === 'siempre') return true;
        $ultimo = $this->parseDate($ultimoRec);
        if (!$ultimo) return true;
        $today = new DateTimeImmutable('today');
        $diff = (int)$today->diff($ultimo)->format('%r%a');
        if ($frecuencia === 'diaria') return $diff >= 1;
        if ($frecuencia === 'semanal') return $diff >= 7;
        if ($frecuencia === 'quincenal') return $diff >= 15;
        return true;
    }

    private function recipientIds(int $alertaId): array
    {
        $rows = $this->db->fetchAll('SELECT id_usuario FROM alerta_destinatarios WHERE id_alerta = ?', [$alertaId]);
        return array_values(array_filter(array_map(static fn(array $row): int => (int)($row['id_usuario'] ?? 0), $rows), static fn(int $id): bool => $id > 0));
    }

    private function badgeTotal(int $userId): int
    {
        $row = $this->db->fetchOne(
            'SELECT COUNT(*) AS total
             FROM alertas a
             LEFT JOIN alerta_destinatarios ad ON ad.id_alerta = a.id AND ad.id_usuario = ?
             WHERE a.activa = 1
               AND a.completada = 0
               AND a.fecha_vence >= CURDATE()
               AND COALESCE(ad.archivada, 0) = 0
               AND (DATEDIFF(a.fecha_vence, CURDATE()) <= 7 OR a.frecuencia_recordatorio = "siempre")
               AND COALESCE(ad.silenciada, 0) = 0
               AND (a.id_creador = ? OR EXISTS (SELECT 1 FROM alerta_destinatarios adx WHERE adx.id_alerta = a.id AND adx.id_usuario = ?))',
            [$userId, $userId, $userId]
        );
        return (int)($row['total'] ?? 0);
    }

    private function mapAlertRow(array $row, int $currentUserId): array
    {
        $destinatariosIds = [];
        if (!empty($row['destinatarios_ids'])) {
            $destinatariosIds = array_values(array_filter(array_map('intval', explode(',', (string)$row['destinatarios_ids']))));
        }

        return [
            'id' => (int)($row['id'] ?? 0),
            'titulo' => (string)($row['titulo'] ?? ''),
            'descripcion' => $row['descripcion'] ?? null,
            'tipo' => (string)($row['tipo'] ?? 'personal'),
            'fecha_vence' => $this->toDateStr($row['fecha_vence'] ?? null),
            'frecuencia_recordatorio' => (string)($row['frecuencia_recordatorio'] ?? 'semanal'),
            'id_creador' => (int)($row['id_creador'] ?? 0),
            'activa' => (bool)($row['activa'] ?? 0),
            'completada' => (bool)($row['completada'] ?? 0),
            'created_at' => $row['created_at'] ?? null,
            'nombre_creador' => (string)($row['nombre_creador'] ?? ''),
            'silenciada' => (int)($row['silenciada'] ?? 0),
            'archivada' => (int)($row['archivada'] ?? 0),
            'fecha_archivada' => $this->toDateStr($row['fecha_archivada'] ?? null),
            'descartada_hoy' => $this->toDateStr($row['descartada_hoy'] ?? null),
            'ultimo_recordatorio' => $this->toDateStr($row['ultimo_recordatorio'] ?? null),
            'destinatarios_nombres' => (string)($row['destinatarios_nombres'] ?? ''),
            'destinatarios_ids' => $destinatariosIds,
            'dias_restantes' => $this->daysRemaining($row['fecha_vence'] ?? null),
            'es_propia' => (int)($row['id_creador'] ?? 0) === $currentUserId,
        ];
    }

    private function requireCreatorOrAdmin(array $payload, int $creatorId): void
    {
        $userId = $this->currentUserId($payload);
        if ($userId !== $creatorId && !(bool)($payload['is_admin'] ?? false)) {
            throw new RuntimeException('Sin permisos', 403);
        }
    }

    private function alertRowById(int $id): ?array
    {
        return $this->db->fetchOne('SELECT * FROM alertas WHERE id = ? LIMIT 1', [$id]);
    }

    private function alertDestinationExists(int $alertaId, int $userId): bool
    {
        return (bool)$this->db->fetchOne(
            'SELECT 1 FROM alerta_destinatarios WHERE id_alerta = ? AND id_usuario = ? LIMIT 1',
            [$alertaId, $userId]
        );
    }

    private function fetchAlertsForUser(int $userId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT
                a.id, a.titulo, a.descripcion, a.tipo, a.fecha_vence,
                a.frecuencia_recordatorio, a.id_creador, a.activa, a.completada, a.created_at,
                COALESCE(u.nombre, "") AS nombre_creador,
                COALESCE(ad.silenciada, 0) AS silenciada,
                COALESCE(ad.archivada, 0) AS archivada,
                COALESCE(ad.fecha_archivada, NULL) AS fecha_archivada,
                COALESCE(ad.descartada_hoy, NULL) AS descartada_hoy,
                COALESCE(ad.ultimo_recordatorio, NULL) AS ultimo_recordatorio,
                (
                  SELECT GROUP_CONCAT(du.nombre ORDER BY du.nombre SEPARATOR ", ")
                  FROM alerta_destinatarios adc
                  JOIN usuario du ON du.id = adc.id_usuario
                  WHERE adc.id_alerta = a.id
                ) AS destinatarios_nombres,
                (
                  SELECT GROUP_CONCAT(adc2.id_usuario ORDER BY adc2.id_usuario SEPARATOR ",")
                  FROM alerta_destinatarios adc2
                  WHERE adc2.id_alerta = a.id
                ) AS destinatarios_ids
             FROM alertas a
             LEFT JOIN usuario u ON u.id = a.id_creador
             LEFT JOIN alerta_destinatarios ad ON ad.id_alerta = a.id AND ad.id_usuario = ?
             WHERE a.id_creador = ?
                OR EXISTS (
                  SELECT 1 FROM alerta_destinatarios adx
                  WHERE adx.id_alerta = a.id AND adx.id_usuario = ?
                )
             ORDER BY a.activa DESC, a.completada ASC, a.fecha_vence ASC',
            [$userId, $userId, $userId]
        );
        return array_map(fn(array $row): array => $this->mapAlertRow($row, $userId), $rows);
    }

    public function listar(array $payload): array
    {
        $userId = $this->currentUserId($payload);
        return ['ok' => true, 'data' => $this->fetchAlertsForUser($userId)];
    }

    public function contador(array $payload): array
    {
        $userId = $this->currentUserId($payload);
        return ['ok' => true, 'total' => $this->badgeTotal($userId)];
    }

    public function badge(array $payload): array
    {
        return $this->contador($payload);
    }

    public function pendientes(array $payload): array
    {
        $userId = $this->currentUserId($payload);
        $today = (new DateTimeImmutable('today'))->format('Y-m-d');
        $rows = $this->db->fetchAll(
            'SELECT
                a.id, a.titulo, a.descripcion, a.tipo, a.fecha_vence,
                a.frecuencia_recordatorio, a.id_creador,
                COALESCE(u.nombre, "") AS nombre_creador,
                COALESCE(ad.silenciada, 0) AS silenciada,
                COALESCE(ad.descartada_hoy, NULL) AS descartada_hoy,
                COALESCE(ad.ultimo_recordatorio, NULL) AS ultimo_recordatorio
             FROM alertas a
             LEFT JOIN usuario u ON u.id = a.id_creador
             LEFT JOIN alerta_destinatarios ad ON ad.id_alerta = a.id AND ad.id_usuario = ?
             WHERE a.activa = 1 AND a.completada = 0
               AND a.fecha_vence >= CURDATE()
               AND COALESCE(ad.archivada, 0) = 0
               AND (DATEDIFF(a.fecha_vence, CURDATE()) <= 7 OR a.frecuencia_recordatorio = "siempre")
               AND COALESCE(ad.silenciada, 0) = 0
               AND (ad.descartada_hoy IS NULL OR ad.descartada_hoy != ?)
               AND (a.id_creador = ? OR EXISTS (SELECT 1 FROM alerta_destinatarios adx WHERE adx.id_alerta = a.id AND adx.id_usuario = ?))
             ORDER BY a.fecha_vence ASC',
            [$userId, $today, $userId, $userId]
        );

        $data = array_values(array_filter(array_map(function (array $row): array {
            return [
                'id' => (int)($row['id'] ?? 0),
                'titulo' => (string)($row['titulo'] ?? ''),
                'descripcion' => $row['descripcion'] ?? null,
                'tipo' => (string)($row['tipo'] ?? 'personal'),
                'fecha_vence' => $this->toDateStr($row['fecha_vence'] ?? null),
                'frecuencia_recordatorio' => (string)($row['frecuencia_recordatorio'] ?? 'semanal'),
                'id_creador' => (int)($row['id_creador'] ?? 0),
                'nombre_creador' => (string)($row['nombre_creador'] ?? ''),
                'silenciada' => (int)($row['silenciada'] ?? 0),
                'descartada_hoy' => $this->toDateStr($row['descartada_hoy'] ?? null),
                'ultimo_recordatorio' => $this->toDateStr($row['ultimo_recordatorio'] ?? null),
                'dias_restantes' => $this->daysRemaining($row['fecha_vence'] ?? null),
            ];
        }, $rows), fn(array $row): bool => $this->shouldRemember($row['ultimo_recordatorio'], $row['frecuencia_recordatorio'])));

        return ['ok' => true, 'data' => $data];
    }

    public function usuarios(array $payload): array
    {
        $this->assertAuth($payload);
        $rows = $this->db->fetchAll('SELECT id, nombre, area FROM usuario WHERE is_active = 1 ORDER BY nombre ASC');
        return ['ok' => true, 'data' => $rows];
    }

    public function crear(array $payload, array $body): array
    {
        $userId = $this->currentUserId($payload);
        $titulo = $this->normalizeText($body['titulo'] ?? '');
        $descripcion = $this->normalizeText($body['descripcion'] ?? '');
        $tipo = $this->normalizeText($body['tipo'] ?? 'personal');
        $fechaVence = $this->toDateStr($body['fecha_vence'] ?? null);
        $frecuencia = $this->normalizeText($body['frecuencia_recordatorio'] ?? 'semanal');
        $destinatarios = $body['destinatarios'] ?? [];

        if ($titulo === '' || !$fechaVence) {
            throw new RuntimeException('Título y fecha de vencimiento son obligatorios', 400);
        }
        if (!in_array($tipo, ['personal', 'grupal'], true)) {
            throw new RuntimeException('Tipo inválido', 400);
        }
        if (!in_array($frecuencia, ['siempre', 'diaria', 'semanal', 'quincenal'], true)) {
            throw new RuntimeException('Frecuencia inválida', 400);
        }

        $pdo = $this->db->mysql();
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare(
                'INSERT INTO alertas (titulo, descripcion, tipo, fecha_vence, frecuencia_recordatorio, id_creador)
                 VALUES (?, ?, ?, ?, ?, ?)'
            );
            $stmt->execute([$titulo, $descripcion !== '' ? $descripcion : null, $tipo, $fechaVence, $frecuencia, $userId]);
            $alertaId = (int)$pdo->lastInsertId();

            $ids = array_values(array_filter(array_map(static fn(mixed $id): int => (int)$id, is_array($destinatarios) ? $destinatarios : []), static fn(int $id): bool => $id > 0));
            $ids = array_values(array_unique(array_merge([$userId], $ids)));
            $stmtDest = $pdo->prepare('INSERT IGNORE INTO alerta_destinatarios (id_alerta, id_usuario) VALUES (?, ?)');
            foreach ($ids as $did) {
                $stmtDest->execute([$alertaId, $did]);
            }
            $pdo->commit();
            return ['ok' => true, 'id' => $alertaId];
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
    }

    public function actualizar(array $payload, int $id, array $body): array
    {
        $userId = $this->currentUserId($payload);
        $titulo = $this->normalizeText($body['titulo'] ?? '');
        $descripcion = $this->normalizeText($body['descripcion'] ?? '');
        $tipo = $this->normalizeText($body['tipo'] ?? 'personal');
        $fechaVence = $this->toDateStr($body['fecha_vence'] ?? null);
        $frecuencia = $this->normalizeText($body['frecuencia_recordatorio'] ?? 'semanal');
        $destinatarios = $body['destinatarios'] ?? [];

        $alerta = $this->alertRowById($id);
        if (!$alerta) {
            throw new RuntimeException('Alerta no encontrada', 404);
        }
        $this->requireCreatorOrAdmin($payload, (int)$alerta['id_creador']);

        $pdo = $this->db->mysql();
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare(
                'UPDATE alertas SET titulo = ?, descripcion = ?, tipo = ?, fecha_vence = ?, frecuencia_recordatorio = ? WHERE id = ?'
            );
            $stmt->execute([$titulo, $descripcion !== '' ? $descripcion : null, $tipo, $fechaVence, $frecuencia, $id]);
            $pdo->prepare('DELETE FROM alerta_destinatarios WHERE id_alerta = ?')->execute([$id]);
            $ids = array_values(array_filter(array_map(static fn(mixed $id): int => (int)$id, is_array($destinatarios) ? $destinatarios : []), static fn(int $i): bool => $i > 0));
            $ids = array_values(array_unique(array_merge([$userId], $ids)));
            $stmtDest = $pdo->prepare('INSERT IGNORE INTO alerta_destinatarios (id_alerta, id_usuario) VALUES (?, ?)');
            foreach ($ids as $did) {
                $stmtDest->execute([$id, $did]);
            }
            $pdo->commit();
            return ['ok' => true];
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
    }

    public function completar(array $payload, int $id): array
    {
        $userId = $this->currentUserId($payload);
        $alerta = $this->alertRowById($id);
        if (!$alerta) {
            throw new RuntimeException('No encontrada', 404);
        }
        $this->requireCreatorOrAdmin($payload, (int)$alerta['id_creador']);
        $this->db->execute('UPDATE alertas SET completada = 1, activa = 0 WHERE id = ?', [$id]);
        return ['ok' => true];
    }

    public function desactivar(array $payload, int $id): array
    {
        $alerta = $this->alertRowById($id);
        if (!$alerta) throw new RuntimeException('No encontrada', 404);
        $this->requireCreatorOrAdmin($payload, (int)$alerta['id_creador']);
        $this->db->execute('UPDATE alertas SET activa = 0 WHERE id = ?', [$id]);
        return ['ok' => true];
    }

    public function activar(array $payload, int $id): array
    {
        $alerta = $this->alertRowById($id);
        if (!$alerta) throw new RuntimeException('No encontrada', 404);
        $this->requireCreatorOrAdmin($payload, (int)$alerta['id_creador']);
        if ((int)($alerta['completada'] ?? 0) === 1) {
            throw new RuntimeException('No se puede activar una alerta completada', 400);
        }
        $this->db->execute('UPDATE alertas SET activa = 1 WHERE id = ?', [$id]);
        return ['ok' => true];
    }

    public function archivar(array $payload, int $id): array
    {
        $userId = $this->currentUserId($payload);
        $alerta = $this->alertRowById($id);
        if (!$alerta) throw new RuntimeException('No encontrada', 404);
        if ($userId !== (int)$alerta['id_creador'] && !$this->alertDestinationExists($id, $userId)) {
            throw new RuntimeException('Sin permisos', 403);
        }
        $stmt = $this->db->mysql()->prepare(
            'INSERT INTO alerta_destinatarios (id_alerta, id_usuario, archivada, fecha_archivada)
             VALUES (?, ?, 1, NOW())
             ON DUPLICATE KEY UPDATE archivada = 1, fecha_archivada = NOW()'
        );
        $stmt->execute([$id, $userId]);
        return ['ok' => true];
    }

    public function desarchivar(array $payload, int $id): array
    {
        $userId = $this->currentUserId($payload);
        $alerta = $this->alertRowById($id);
        if (!$alerta) throw new RuntimeException('No encontrada', 404);
        if ($userId !== (int)$alerta['id_creador'] && !$this->alertDestinationExists($id, $userId)) {
            throw new RuntimeException('Sin permisos', 403);
        }
        $stmt = $this->db->mysql()->prepare(
            'INSERT INTO alerta_destinatarios (id_alerta, id_usuario, archivada, fecha_archivada)
             VALUES (?, ?, 0, NULL)
             ON DUPLICATE KEY UPDATE archivada = 0, fecha_archivada = NULL'
        );
        $stmt->execute([$id, $userId]);
        return ['ok' => true];
    }

    public function descartar(array $payload, int $id): array
    {
        $userId = $this->currentUserId($payload);
        $today = (new DateTimeImmutable('today'))->format('Y-m-d');
        $stmt = $this->db->mysql()->prepare(
            'INSERT INTO alerta_destinatarios (id_alerta, id_usuario, descartada_hoy, ultimo_recordatorio)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE descartada_hoy = VALUES(descartada_hoy), ultimo_recordatorio = VALUES(ultimo_recordatorio)'
        );
        $stmt->execute([$id, $userId, $today, $today]);
        return ['ok' => true];
    }

    public function silenciar(array $payload, int $id): array
    {
        $userId = $this->currentUserId($payload);
        $stmt = $this->db->mysql()->prepare(
            'INSERT INTO alerta_destinatarios (id_alerta, id_usuario, silenciada)
             VALUES (?, ?, 1)
             ON DUPLICATE KEY UPDATE silenciada = 1'
        );
        $stmt->execute([$id, $userId]);
        return ['ok' => true];
    }

    public function eliminar(array $payload, int $id): array
    {
        $userId = $this->currentUserId($payload);
        $alerta = $this->alertRowById($id);
        if (!$alerta) throw new RuntimeException('No encontrada', 404);
        if ($userId !== (int)$alerta['id_creador'] && !$this->parseBool($payload['is_admin'] ?? false)) {
            throw new RuntimeException('Sin permisos para eliminar', 403);
        }
        $this->db->execute('DELETE FROM alertas WHERE id = ?', [$id]);
        return ['ok' => true];
    }

    public function route(array $payload, string $method, string $path, array $query, array $body): array
    {
        if ($method === 'GET' && $path === '/') return $this->listar($payload);
        if ($method === 'GET' && $path === '/contador') return $this->contador($payload);
        if ($method === 'GET' && $path === '/badge') return $this->badge($payload);
        if ($method === 'GET' && $path === '/pendientes') return $this->pendientes($payload);
        if ($method === 'GET' && $path === '/usuarios') return $this->usuarios($payload);
        if ($method === 'POST' && $path === '/') return $this->crear($payload, $body);
        if ($method === 'PUT' && preg_match('#^/(\d+)$#', $path, $m)) return $this->actualizar($payload, (int)$m[1], $body);
        if ($method === 'PATCH' && preg_match('#^/(\d+)/completar$#', $path, $m)) return $this->completar($payload, (int)$m[1]);
        if ($method === 'PATCH' && preg_match('#^/(\d+)/desactivar$#', $path, $m)) return $this->desactivar($payload, (int)$m[1]);
        if ($method === 'PATCH' && preg_match('#^/(\d+)/activar$#', $path, $m)) return $this->activar($payload, (int)$m[1]);
        if ($method === 'PATCH' && preg_match('#^/(\d+)/archivar$#', $path, $m)) return $this->archivar($payload, (int)$m[1]);
        if ($method === 'PATCH' && preg_match('#^/(\d+)/desarchivar$#', $path, $m)) return $this->desarchivar($payload, (int)$m[1]);
        if ($method === 'PATCH' && preg_match('#^/(\d+)/descartar$#', $path, $m)) return $this->descartar($payload, (int)$m[1]);
        if ($method === 'PATCH' && preg_match('#^/(\d+)/silenciar$#', $path, $m)) return $this->silenciar($payload, (int)$m[1]);
        if ($method === 'DELETE' && preg_match('#^/(\d+)$#', $path, $m)) return $this->eliminar($payload, (int)$m[1]);
        throw new RuntimeException('Ruta de alertas no encontrada', 404);
    }
}
