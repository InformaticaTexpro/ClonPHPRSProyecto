<?php
declare(strict_types=1);

final class MensajeriaService
{
    public function __construct(private Database $db)
    {
    }

    public function route(array $payload, string $method, string $path, array $query, array $body): array
    {
        $userId = $this->currentUserId($payload);

        return match (true) {
            $method === 'GET' && $path === '/directorio' => [
                'ok' => true,
                'data' => $this->getDirectory($userId),
            ],
            $method === 'GET' && $path === '/conversaciones' => [
                'ok' => true,
                'data' => $this->listConversations($userId, $this->asBool($query['incluir_archivadas'] ?? false, false)),
            ],
            $method === 'GET' && preg_match('#^/conversaciones/(\d+)/mensajes$#', $path, $matches) => [
                'ok' => true,
                'data' => $this->listConversationMessages((int)$matches[1], $userId),
            ],
            $method === 'POST' && $path === '/conversaciones' => [
                'ok' => true,
                'data' => $this->createConversation($userId, $body),
            ],
            $method === 'POST' && preg_match('#^/conversaciones/(\d+)/mensajes$#', $path, $matches) => [
                'ok' => true,
                'data' => $this->createMessage((int)$matches[1], $userId, (string)($body['cuerpo'] ?? ''), (string)($body['tipo'] ?? 'texto')),
            ],
            $method === 'PATCH' && preg_match('#^/conversaciones/(\d+)/leido$#', $path, $matches) => [
                'ok' => true,
                'data' => $this->markConversationRead((int)$matches[1], $userId),
            ],
            $method === 'GET' && $path === '/no-leidos' => [
                'ok' => true,
                'data' => $this->countUnread($userId),
            ],
            $method === 'GET' && $path === '/usuarios-online' => [
                'ok' => true,
                'online' => [],
            ],
            $method === 'PATCH' && preg_match('#^/conversaciones/(\d+)/archivar$#', $path, $matches) => [
                'ok' => true,
                'data' => $this->updateConversationFlag((int)$matches[1], $userId, 'archivada', $this->asBool($body['archivada'] ?? true, true)),
            ],
            $method === 'PATCH' && preg_match('#^/conversaciones/(\d+)/silenciar$#', $path, $matches) => [
                'ok' => true,
                'data' => $this->updateConversationFlag((int)$matches[1], $userId, 'silenciada', $this->asBool($body['silenciada'] ?? true, true)),
            ],
            default => throw new RuntimeException('Ruta de mensajería no encontrada', 404),
        };
    }

    private function currentUserId(array $payload): int
    {
        $userId = (int)($payload['sub'] ?? $payload['id'] ?? 0);
        if ($userId <= 0) {
            throw new RuntimeException('Token inválido.', 401);
        }
        return $userId;
    }

    private function asBool(mixed $value, bool $fallback = false): bool
    {
        if ($value === null || $value === '') {
            return $fallback;
        }
        if (is_bool($value)) {
            return $value;
        }
        if (is_int($value) || is_float($value)) {
            return ((int)$value) !== 0;
        }
        $normalized = mb_strtolower(trim((string)$value));
        return match ($normalized) {
            '1', 'true', 'si', 'sí', 'yes', 'y', 'on' => true,
            '0', 'false', 'no', 'off' => false,
            default => $fallback,
        };
    }

    private function parseId(mixed $value, string $label = 'ID'): int
    {
        $id = (int)$value;
        if ($id <= 0) {
            throw new RuntimeException($label . ' inválido', 400);
        }
        return $id;
    }

    private function getDirectory(int $userId): array
    {
        $usuarios = $this->db->fetchAll(
            'SELECT id, nombre, email, area, is_admin, is_active
             FROM usuario
             WHERE is_active = 1
             ORDER BY area ASC, nombre ASC'
        );

        $areas = $this->db->fetchAll(
            "SELECT DISTINCT TRIM(COALESCE(area, '')) AS area
             FROM usuario
             WHERE is_active = 1
               AND TRIM(COALESCE(area, '')) <> ''
             ORDER BY area ASC"
        );

        return [
            'usuarios' => array_values(array_filter(array_map(fn (array $row): array => $this->mapUsuario($row), $usuarios), static fn (array $row): bool => (int)$row['id'] !== $userId)),
            'areas' => array_map(static fn (array $row): array => [
                'codigo' => (string)($row['area'] ?? ''),
                'nombre' => (string)($row['area'] ?? ''),
            ], $areas),
        ];
    }

    private function listConversations(int $userId, bool $includeArchived = false): array
    {
        $sql = "
            SELECT c.id, c.tipo, c.titulo, c.area_codigo, c.creado_por, c.activo, c.created_at, c.updated_at,
                   cp.rol, cp.silenciada, cp.archivada, cp.ultimo_leido_mensaje_id
            FROM conversacion c
            INNER JOIN conversacion_participante cp
              ON cp.conversacion_id = c.id
             AND cp.usuario_id = ?
            WHERE c.activo = 1
        ";
        if (!$includeArchived) {
            $sql .= ' AND cp.archivada = 0';
        }
        $sql .= ' ORDER BY c.updated_at DESC, c.created_at DESC';

        $rows = $this->db->fetchAll($sql, [$userId]);
        $conversations = array_map(fn (array $row): array => $this->mapConversationBase($row) + [
            'rol' => (string)($row['rol'] ?? 'miembro'),
            'silenciada' => (bool)($row['silenciada'] ?? false),
            'archivada' => (bool)($row['archivada'] ?? false),
            'ultimo_leido_mensaje_id' => isset($row['ultimo_leido_mensaje_id']) && $row['ultimo_leido_mensaje_id'] !== null ? (int)$row['ultimo_leido_mensaje_id'] : null,
        ], $rows);

        $ids = array_map(static fn (array $item): int => (int)$item['id'], $conversations);
        $participantsMap = $this->loadParticipants($ids);
        $lastMessagesMap = $this->loadLastMessages($ids);
        $unreadMap = $this->loadUnreadCounts($userId, $ids);

        return array_map(static function (array $conversation) use ($participantsMap, $lastMessagesMap, $unreadMap): array {
            $id = (int)$conversation['id'];
            return $conversation + [
                'participantes' => $participantsMap[$id] ?? [],
                'ultimo_mensaje' => $lastMessagesMap[$id] ?? null,
                'no_leidos' => $unreadMap[$id] ?? 0,
            ];
        }, $conversations);
    }

    private function listConversationMessages(int $conversacionId, int $userId): array
    {
        $participant = $this->findParticipant($conversacionId, $userId);
        if (!$participant) {
            throw new RuntimeException('No tienes acceso a esta conversación', 403);
        }

        $conversation = $this->findConversation($conversacionId, $userId);
        if (!$conversation || !(bool)($conversation['activo'] ?? false)) {
            throw new RuntimeException('Conversación no encontrada', 404);
        }

        $mensajes = $this->db->fetchAll(
            "SELECT m.id, m.conversacion_id, m.remitente_id, u.nombre AS remitente_nombre, u.email AS remitente_email,
                    u.area AS remitente_area, m.cuerpo, m.tipo, m.eliminado, m.created_at, m.editado_at
             FROM mensaje m
             INNER JOIN usuario u ON u.id = m.remitente_id
             WHERE m.conversacion_id = ?
               AND m.eliminado = 0
             ORDER BY m.created_at ASC, m.id ASC",
            [$conversacionId]
        );

        $participantsRows = $this->db->fetchAll(
            "SELECT cp.conversacion_id, cp.usuario_id, cp.rol, cp.silenciada, cp.archivada, cp.ultimo_leido_mensaje_id, cp.created_at,
                    u.nombre, u.email, u.area, u.is_active
             FROM conversacion_participante cp
             INNER JOIN usuario u ON u.id = cp.usuario_id
             WHERE cp.conversacion_id = ?
             ORDER BY cp.rol DESC, u.nombre ASC",
            [$conversacionId]
        );

        return [
            'conversacion' => $conversation + [
                'participantes' => array_map(fn (array $row): array => $this->mapParticipant($row), $participantsRows),
            ],
            'mensajes' => array_map(fn (array $row): array => $this->mapMessage($row), $mensajes),
        ];
    }

    private function createConversation(int $userId, array $data): array
    {
        $tipo = $this->normalizeType($data['tipo'] ?? null);
        if ($tipo === null) {
            throw new RuntimeException('Tipo de conversación inválido', 400);
        }

        $titulo = trim((string)($data['titulo'] ?? ''));
        $areaCodigo = trim((string)($data['area_codigo'] ?? ''));
        $areaCodigo = $areaCodigo !== '' ? mb_strtolower($areaCodigo) : '';
        $participantesIdsRaw = is_array($data['usuario_ids'] ?? null)
            ? $data['usuario_ids']
            : (is_array($data['participantes_ids'] ?? null)
                ? $data['participantes_ids']
                : ((isset($data['usuario_id']) && $data['usuario_id'] !== null && $data['usuario_id'] !== '') ? [$data['usuario_id']] : []));

        $creator = $this->db->fetchOne(
            'SELECT id, nombre, email, area, is_active
             FROM usuario
             WHERE id = ? AND is_active = 1
             LIMIT 1',
            [$userId]
        );
        if (!$creator) {
            throw new RuntimeException('Usuario autenticado no disponible', 401);
        }

        $participantesIds = [];
        if ($tipo === 'directa') {
            $unique = array_values(array_unique(array_map(
                static fn (mixed $value): int => (int)$value,
                array_filter($participantesIdsRaw, static fn (mixed $value): bool => (int)$value > 0)
            )));
            $unique = array_values(array_filter($unique, static fn (int $value): bool => $value !== $userId));
            if (count($unique) !== 1) {
                throw new RuntimeException('La conversación directa requiere un único destinatario', 400);
            }

            $destinatarioId = $unique[0];
            $activeUserIds = $this->fetchActiveUserIds([$userId, $destinatarioId]);
            if (!in_array($userId, $activeUserIds, true) || !in_array($destinatarioId, $activeUserIds, true)) {
                throw new RuntimeException('Uno o más participantes no están activos', 400);
            }

            $existingDirect = $this->findDirectConversation($userId, $destinatarioId);
            if ($existingDirect) {
                return $existingDirect;
            }

            $participantesIds = [$userId, $destinatarioId];
        } elseif ($tipo === 'area') {
            if ($areaCodigo === '') {
                throw new RuntimeException('Debes indicar el área de la conversación', 400);
            }

            $rows = $this->db->fetchAll(
                "SELECT id
                 FROM usuario
                 WHERE is_active = 1
                   AND LOWER(TRIM(COALESCE(area, ''))) = LOWER(TRIM(?))",
                [$areaCodigo]
            );
            $participantesIds = array_values(array_unique(array_merge([$userId], array_map(static fn (array $row): int => (int)$row['id'], $rows))));
            if (!$participantesIds) {
                throw new RuntimeException('No hay usuarios activos para el área seleccionada', 400);
            }
        } else {
            $participantesIds = array_values(array_unique(array_merge([$userId], array_map(static fn (mixed $value): int => (int)$value, $participantesIdsRaw))));
            $participantesIds = array_values(array_filter($participantesIds, static fn (int $value): bool => $value > 0));
            if (!$participantesIds) {
                throw new RuntimeException('Debes indicar al menos un participante', 400);
            }
        }

        $activeUserIds = $this->fetchActiveUserIds($participantesIds);
        $missing = array_values(array_filter($participantesIds, static fn (int $id): bool => !in_array($id, $activeUserIds, true)));
        if ($missing) {
            throw new RuntimeException('Uno o más participantes no están activos', 400);
        }

        $conversationId = $this->withTransaction(function (PDO $pdo) use ($userId, $tipo, $titulo, $areaCodigo, $participantesIds): int {
            $stmt = $pdo->prepare(
                'INSERT INTO conversacion (tipo, titulo, area_codigo, creado_por, activo)
                 VALUES (?, ?, ?, ?, 1)'
            );
            $stmt->execute([$tipo, $titulo !== '' ? $titulo : null, $areaCodigo !== '' ? $areaCodigo : null, $userId]);
            $insertId = (int)$pdo->lastInsertId();

            $participantStmt = $pdo->prepare(
                'INSERT INTO conversacion_participante (conversacion_id, usuario_id, rol, silenciada, archivada, ultimo_leido_mensaje_id)
                 VALUES (?, ?, ?, 0, 0, NULL)
                 ON DUPLICATE KEY UPDATE rol = VALUES(rol)'
            );
            foreach ($participantesIds as $participantId) {
                $participantStmt->execute([
                    $insertId,
                    (int)$participantId,
                    (int)$participantId === $userId ? 'admin' : 'miembro',
                ]);
            }

            return $insertId;
        });

        return $this->findConversation($conversationId, $userId) ?? [];
    }

    private function createMessage(int $conversacionId, int $userId, string $cuerpo, string $tipo = 'texto'): array
    {
        $participant = $this->findParticipant($conversacionId, $userId);
        if (!$participant) {
            throw new RuntimeException('No tienes acceso a esta conversación', 403);
        }

        $texto = trim($cuerpo);
        if ($texto === '') {
            throw new RuntimeException('El mensaje no puede estar vacío', 400);
        }
        if (mb_strlen($texto) > 4000) {
            throw new RuntimeException('El mensaje supera el largo permitido', 400);
        }

        $tipoNormalizado = $this->normalizeType($tipo) === 'sistema' ? 'sistema' : 'texto';

        $messageId = $this->withTransaction(function (PDO $pdo) use ($conversacionId, $userId, $texto, $tipoNormalizado): int {
            $stmt = $pdo->prepare(
                'INSERT INTO mensaje (conversacion_id, remitente_id, cuerpo, tipo, eliminado)
                 VALUES (?, ?, ?, ?, 0)'
            );
            $stmt->execute([$conversacionId, $userId, $texto, $tipoNormalizado]);

            $pdo->prepare('UPDATE conversacion SET updated_at = NOW() WHERE id = ?')->execute([$conversacionId]);
            $pdo->prepare(
                'UPDATE conversacion_participante
                 SET archivada = 0
                 WHERE conversacion_id = ? AND usuario_id = ?'
            )->execute([$conversacionId, $userId]);

            return (int)$pdo->lastInsertId();
        });

        $rows = $this->db->fetchAll(
            "SELECT m.id, m.conversacion_id, m.remitente_id, u.nombre AS remitente_nombre, u.email AS remitente_email,
                    u.area AS remitente_area, m.cuerpo, m.tipo, m.eliminado, m.created_at, m.editado_at
             FROM mensaje m
             INNER JOIN usuario u ON u.id = m.remitente_id
             WHERE m.id = ?
             LIMIT 1",
            [$messageId]
        );

        return $rows[0] ? $this->mapMessage($rows[0]) : [];
    }

    private function markConversationRead(int $conversacionId, int $userId): array
    {
        $participant = $this->findParticipant($conversacionId, $userId);
        if (!$participant) {
            throw new RuntimeException('No tienes acceso a esta conversación', 403);
        }

        $row = $this->db->fetchOne(
            'SELECT MAX(id) AS ultimo_id
             FROM mensaje
             WHERE conversacion_id = ?
               AND eliminado = 0',
            [$conversacionId]
        );
        $ultimoId = isset($row['ultimo_id']) && $row['ultimo_id'] !== null ? (int)$row['ultimo_id'] : null;

        $this->db->execute(
            'UPDATE conversacion_participante
             SET ultimo_leido_mensaje_id = ?
             WHERE conversacion_id = ? AND usuario_id = ?',
            [$ultimoId, $conversacionId, $userId]
        );

        return [
            'conversacion_id' => $conversacionId,
            'ultimo_leido_mensaje_id' => $ultimoId,
        ];
    }

    private function countUnread(int $userId): array
    {
        $row = $this->db->fetchOne(
            "SELECT
               COUNT(DISTINCT CASE WHEN x.total > 0 THEN x.conversacion_id END) AS conversaciones,
               COALESCE(SUM(x.total), 0) AS total
             FROM (
               SELECT m.conversacion_id, COUNT(*) AS total
               FROM mensaje m
               INNER JOIN conversacion_participante cp
                 ON cp.conversacion_id = m.conversacion_id
                AND cp.usuario_id = ?
               WHERE m.eliminado = 0
                 AND m.remitente_id <> ?
                 AND (cp.ultimo_leido_mensaje_id IS NULL OR m.id > cp.ultimo_leido_mensaje_id)
               GROUP BY m.conversacion_id
             ) x",
            [$userId, $userId]
        );

        return [
            'conversaciones' => (int)($row['conversaciones'] ?? 0),
            'total' => (int)($row['total'] ?? 0),
        ];
    }

    private function updateConversationFlag(int $conversacionId, int $userId, string $campo, bool $valor): array
    {
        if (!in_array($campo, ['archivada', 'silenciada'], true)) {
            throw new RuntimeException('Campo inválido', 400);
        }

        $participant = $this->findParticipant($conversacionId, $userId);
        if (!$participant) {
            throw new RuntimeException('No tienes acceso a esta conversación', 403);
        }

        $this->db->execute(
            sprintf(
                'UPDATE conversacion_participante
                 SET %s = ?
                 WHERE conversacion_id = ? AND usuario_id = ?',
                $campo
            ),
            [$valor ? 1 : 0, $conversacionId, $userId]
        );

        return [
            'conversacion_id' => $conversacionId,
            $campo => $valor,
        ];
    }

    private function fetchActiveUserIds(array $ids): array
    {
        $ids = array_values(array_unique(array_map(static fn (mixed $value): int => (int)$value, $ids)));
        $ids = array_values(array_filter($ids, static fn (int $value): bool => $value > 0));
        if (!$ids) {
            return [];
        }

        $placeholders = implode(', ', array_fill(0, count($ids), '?'));
        $rows = $this->db->fetchAll(
            "SELECT id
             FROM usuario
             WHERE id IN ($placeholders)
               AND is_active = 1",
            $ids
        );

        return array_map(static fn (array $row): int => (int)$row['id'], $rows);
    }

    private function findParticipant(int $conversacionId, int $userId): ?array
    {
        $row = $this->db->fetchOne(
            'SELECT cp.conversacion_id, cp.usuario_id, cp.rol, cp.silenciada, cp.archivada, cp.ultimo_leido_mensaje_id, cp.created_at,
                    u.nombre, u.email, u.area, u.is_active
             FROM conversacion_participante cp
             INNER JOIN usuario u ON u.id = cp.usuario_id
             WHERE cp.conversacion_id = ? AND cp.usuario_id = ?
             LIMIT 1',
            [$conversacionId, $userId]
        );

        if (!$row) {
            return null;
        }

        return $this->mapParticipant($row);
    }

    private function findConversation(int $conversacionId, ?int $userId = null): ?array
    {
        if ($userId !== null) {
            $row = $this->db->fetchOne(
                'SELECT c.id, c.tipo, c.titulo, c.area_codigo, c.creado_por, c.activo, c.created_at, c.updated_at,
                        cp.rol, cp.silenciada, cp.archivada, cp.ultimo_leido_mensaje_id
                 FROM conversacion c
                 INNER JOIN conversacion_participante cp ON cp.conversacion_id = c.id AND cp.usuario_id = ?
                 WHERE c.id = ?
                 LIMIT 1',
                [$userId, $conversacionId]
            );
        } else {
            $row = $this->db->fetchOne(
                'SELECT c.id, c.tipo, c.titulo, c.area_codigo, c.creado_por, c.activo, c.created_at, c.updated_at
                 FROM conversacion c
                 WHERE c.id = ?
                 LIMIT 1',
                [$conversacionId]
            );
        }

        if (!$row) {
            return null;
        }

        $conversation = $this->mapConversationBase($row);
        if ($userId !== null) {
            $conversation += [
                'rol' => (string)($row['rol'] ?? 'miembro'),
                'silenciada' => (bool)($row['silenciada'] ?? false),
                'archivada' => (bool)($row['archivada'] ?? false),
                'ultimo_leido_mensaje_id' => isset($row['ultimo_leido_mensaje_id']) && $row['ultimo_leido_mensaje_id'] !== null ? (int)$row['ultimo_leido_mensaje_id'] : null,
            ];
        }

        return $conversation;
    }

    private function findDirectConversation(int $usuarioId, int $destinatarioId): ?array
    {
        $row = $this->db->fetchOne(
            "SELECT c.id
             FROM conversacion c
             INNER JOIN conversacion_participante cp ON cp.conversacion_id = c.id
             WHERE c.tipo = 'directa'
               AND c.activo = 1
             GROUP BY c.id
             HAVING COUNT(*) = 2
                AND SUM(cp.usuario_id = ?) = 1
                AND SUM(cp.usuario_id = ?) = 1
             LIMIT 1",
            [$usuarioId, $destinatarioId]
        );

        if (!$row) {
            return null;
        }

        return $this->findConversation((int)$row['id'], $usuarioId);
    }

    private function loadParticipants(array $conversacionIds): array
    {
        if (!$conversacionIds) {
            return [];
        }

        $placeholders = implode(', ', array_fill(0, count($conversacionIds), '?'));
        $rows = $this->db->fetchAll(
            "SELECT cp.conversacion_id, cp.usuario_id, cp.rol, cp.silenciada, cp.archivada, cp.ultimo_leido_mensaje_id, cp.created_at,
                    u.nombre, u.email, u.area, u.is_active
             FROM conversacion_participante cp
             INNER JOIN usuario u ON u.id = cp.usuario_id
             WHERE cp.conversacion_id IN ($placeholders)
             ORDER BY cp.conversacion_id ASC, cp.rol DESC, u.nombre ASC",
            $conversacionIds
        );

        $map = [];
        foreach ($rows as $row) {
            $key = (int)$row['conversacion_id'];
            $map[$key] ??= [];
            $map[$key][] = $this->mapParticipant($row);
        }
        return $map;
    }

    private function loadLastMessages(array $conversacionIds): array
    {
        if (!$conversacionIds) {
            return [];
        }

        $placeholders = implode(', ', array_fill(0, count($conversacionIds), '?'));
        $rows = $this->db->fetchAll(
            "SELECT m.conversacion_id, m.id, m.remitente_id, u.nombre AS remitente_nombre, u.email AS remitente_email,
                    u.area AS remitente_area, m.cuerpo, m.tipo, m.eliminado, m.created_at, m.editado_at
             FROM mensaje m
             INNER JOIN (
               SELECT conversacion_id, MAX(id) AS last_message_id
               FROM mensaje
               WHERE eliminado = 0
                 AND conversacion_id IN ($placeholders)
               GROUP BY conversacion_id
             ) ultima ON ultima.last_message_id = m.id
             INNER JOIN usuario u ON u.id = m.remitente_id
             ORDER BY m.created_at DESC, m.id DESC",
            $conversacionIds
        );

        $map = [];
        foreach ($rows as $row) {
            $map[(int)$row['conversacion_id']] = $this->mapMessage($row);
        }
        return $map;
    }

    private function loadUnreadCounts(int $userId, array $conversacionIds): array
    {
        if (!$conversacionIds) {
            return [];
        }

        $placeholders = implode(', ', array_fill(0, count($conversacionIds), '?'));
        $rows = $this->db->fetchAll(
            "SELECT m.conversacion_id, COUNT(*) AS total
             FROM mensaje m
             INNER JOIN conversacion_participante cp
               ON cp.conversacion_id = m.conversacion_id
              AND cp.usuario_id = ?
             WHERE m.conversacion_id IN ($placeholders)
               AND m.eliminado = 0
               AND m.remitente_id <> ?
               AND (cp.ultimo_leido_mensaje_id IS NULL OR m.id > cp.ultimo_leido_mensaje_id)
             GROUP BY m.conversacion_id",
            array_merge([$userId], $conversacionIds, [$userId])
        );

        $map = [];
        foreach ($rows as $row) {
            $map[(int)$row['conversacion_id']] = (int)$row['total'];
        }
        return $map;
    }

    private function normalizeType(mixed $value): ?string
    {
        $text = trim(mb_strtolower((string)$value));
        return match ($text) {
            'directa', 'direct', 'dm' => 'directa',
            'grupo', 'group' => 'grupo',
            'area', 'área' => 'area',
            'sistema', 'system' => 'sistema',
            default => null,
        };
    }

    private function mapUsuario(array $row): array
    {
        return [
            'id' => (int)($row['id'] ?? 0),
            'nombre' => (string)($row['nombre'] ?? ''),
            'email' => (string)($row['email'] ?? ''),
            'area' => (string)($row['area'] ?? ''),
            'is_admin' => (bool)($row['is_admin'] ?? false),
            'is_active' => (bool)($row['is_active'] ?? false),
        ];
    }

    private function mapParticipant(array $row): array
    {
        return [
            'usuario_id' => (int)($row['usuario_id'] ?? 0),
            'rol' => (string)($row['rol'] ?? 'miembro'),
            'silenciada' => (bool)($row['silenciada'] ?? false),
            'archivada' => (bool)($row['archivada'] ?? false),
            'ultimo_leido_mensaje_id' => isset($row['ultimo_leido_mensaje_id']) && $row['ultimo_leido_mensaje_id'] !== null ? (int)$row['ultimo_leido_mensaje_id'] : null,
            'created_at' => $row['created_at'] ?? null,
            'usuario' => [
                'id' => (int)($row['usuario_id'] ?? 0),
                'nombre' => (string)($row['nombre'] ?? ''),
                'email' => (string)($row['email'] ?? ''),
                'area' => (string)($row['area'] ?? ''),
                'is_active' => (bool)($row['is_active'] ?? false),
            ],
        ];
    }

    private function mapMessage(array $row): array
    {
        return [
            'id' => (int)($row['id'] ?? 0),
            'conversacion_id' => (int)($row['conversacion_id'] ?? 0),
            'remitente_id' => (int)($row['remitente_id'] ?? 0),
            'remitente_nombre' => (string)($row['remitente_nombre'] ?? ''),
            'remitente_email' => (string)($row['remitente_email'] ?? ''),
            'remitente_area' => (string)($row['remitente_area'] ?? ''),
            'cuerpo' => (string)($row['cuerpo'] ?? ''),
            'tipo' => (string)($row['tipo'] ?? 'texto'),
            'eliminado' => (bool)($row['eliminado'] ?? false),
            'created_at' => $row['created_at'] ?? null,
            'editado_at' => $row['editado_at'] ?? null,
        ];
    }

    private function mapConversationBase(array $row): array
    {
        return [
            'id' => (int)($row['id'] ?? 0),
            'tipo' => (string)($row['tipo'] ?? 'directa'),
            'titulo' => (string)($row['titulo'] ?? ''),
            'area_codigo' => (string)($row['area_codigo'] ?? ''),
            'creado_por' => (int)($row['creado_por'] ?? 0),
            'activo' => (bool)($row['activo'] ?? false),
            'created_at' => $row['created_at'] ?? null,
            'updated_at' => $row['updated_at'] ?? null,
        ];
    }

    private function withTransaction(callable $callback): mixed
    {
        $pdo = $this->db->mysql();
        $pdo->beginTransaction();
        try {
            $result = $callback($pdo);
            $pdo->commit();
            return $result;
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }
}
