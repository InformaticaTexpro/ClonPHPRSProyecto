<?php
declare(strict_types=1);

final class NotificacionesService
{
    public function __construct(private Database $db)
    {
    }

    public function route(array $payload, string $method, string $path, array $query, array $body): array
    {
        $userId = $this->currentUserId($payload);

        return match (true) {
            $method === 'GET' && $path === '/' => [
                'ok' => true,
                'notificaciones' => $this->listNotifications($userId, (string)($query['soloNoLeidas'] ?? '') === '1', (int)($query['limit'] ?? 30)),
            ],
            $method === 'GET' && $path === '/contador' => [
                'ok' => true,
                'total' => $this->countUnread($userId),
            ],
            $method === 'PATCH' && preg_match('#^/(\d+)/leer$#', $path, $matches) => [
                'ok' => true,
                'updated' => $this->markRead((int)$matches[1], $userId),
            ],
            $method === 'PATCH' && $path === '/leer-todo' => [
                'ok' => true,
                'updated' => $this->markAllRead($userId),
            ],
            default => throw new RuntimeException('Ruta de notificaciones no encontrada', 404),
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

    private function listNotifications(int $userId, bool $soloNoLeidas, int $limit): array
    {
        $limit = max(1, min(100, $limit));
        $sql = 'SELECT id, tipo, titulo, mensaje, leida, folio, mes, anio, fecha_creacion
                FROM notificaciones
                WHERE usuario_id = ?';
        $params = [$userId];
        if ($soloNoLeidas) {
            $sql .= ' AND leida = 0';
        }
        $sql .= ' ORDER BY fecha_creacion DESC LIMIT ' . $limit;

        return $this->db->fetchAll($sql, $params);
    }

    private function countUnread(int $userId): int
    {
        $row = $this->db->fetchOne(
            'SELECT COUNT(*) AS total FROM notificaciones WHERE usuario_id = ? AND leida = 0',
            [$userId]
        );
        return (int)($row['total'] ?? 0);
    }

    private function markRead(int $id, int $userId): bool
    {
        if ($id <= 0) {
            throw new RuntimeException('ID inválido', 400);
        }
        $affected = $this->db->execute(
            'UPDATE notificaciones SET leida = 1 WHERE id = ? AND usuario_id = ?',
            [$id, $userId]
        );
        return $affected > 0;
    }

    private function markAllRead(int $userId): int
    {
        return $this->db->execute(
            'UPDATE notificaciones SET leida = 1 WHERE usuario_id = ? AND leida = 0',
            [$userId]
        );
    }
}
