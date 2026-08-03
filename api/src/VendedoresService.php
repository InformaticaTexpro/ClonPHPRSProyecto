<?php
declare(strict_types=1);

final class VendedoresService
{
    public function __construct(private Database $db)
    {
    }

    public function route(array $payload, string $method, string $path, array $query, array $body): array
    {
        return match (true) {
            $method === 'POST' && preg_match('#^/(\d+)/contrato$#', $path, $matches) => $this->uploadContract($payload, (int)$matches[1]),
            $method === 'GET' && preg_match('#^/(\d+)/contrato$#', $path, $matches) => $this->downloadContract($payload, (int)$matches[1], (string)($query['inline'] ?? 'false') === 'true'),
            $method === 'DELETE' && preg_match('#^/(\d+)/contrato$#', $path, $matches) => $this->deleteContract($payload, (int)$matches[1]),
            $method === 'PUT' && preg_match('#^/(\d+)/rut$#', $path, $matches) => $this->updateRut($payload, (int)$matches[1], $body),
            $method === 'GET' && preg_match('#^/(\d+)/info$#', $path, $matches) => $this->getInfo($payload, (int)$matches[1]),
            default => throw new RuntimeException('Ruta de vendedores no encontrada', 404),
        };
    }

    private function rootPath(): string
    {
        return dirname(__DIR__, 2);
    }

    private function uploadDir(): string
    {
        return $this->rootPath() . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'contratos';
    }

    private function ensureUploadDir(): void
    {
        $dir = $this->uploadDir();
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new RuntimeException('No se pudo crear el directorio de contratos', 500);
        }
    }

    private function currentUserId(array $payload): int
    {
        $userId = (int)($payload['sub'] ?? $payload['id'] ?? 0);
        if ($userId <= 0) {
            throw new RuntimeException('Token inválido.', 401);
        }
        return $userId;
    }

    private function isAdmin(array $payload): bool
    {
        return (bool)($payload['is_admin'] ?? false);
    }

    private function canAccess(array $payload, int $targetId): bool
    {
        return $this->isAdmin($payload) || $this->currentUserId($payload) === $targetId;
    }

    private function uploadContract(array $payload, int $id): array
    {
        if (!$this->canAccess($payload, $id)) {
            throw new RuntimeException('Acceso denegado', 403);
        }

        $file = $_FILES['pdf'] ?? null;
        if (!is_array($file) || (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK)) {
            throw new RuntimeException('No se recibió ningún archivo PDF', 400);
        }
        if (($file['type'] ?? '') !== 'application/pdf') {
            throw new RuntimeException('Solo se permiten archivos PDF', 415);
        }
        if ((int)($file['size'] ?? 0) > 10 * 1024 * 1024) {
            throw new RuntimeException('El PDF excede el límite de 10 MB', 413);
        }

        $user = $this->db->fetchOne('SELECT id, pdf_contrato FROM usuario WHERE id = ?', [$id]);
        if (!$user) {
            $this->cleanupFile((string)($file['tmp_name'] ?? ''));
            throw new RuntimeException('Usuario no encontrado', 404);
        }

        $this->ensureUploadDir();
        $filename = sprintf('contrato_%d_%d.pdf', $id, time() * 1000);
        $relative = 'uploads/contratos/' . $filename;
        $absolute = $this->rootPath() . DIRECTORY_SEPARATOR . $relative;

        if (!move_uploaded_file((string)$file['tmp_name'], $absolute)) {
            $this->cleanupFile((string)($file['tmp_name'] ?? ''));
            throw new RuntimeException('No se pudo guardar el archivo', 500);
        }

        $previous = trim((string)($user['pdf_contrato'] ?? ''));
        if ($previous !== '') {
            $previousAbs = $this->rootPath() . DIRECTORY_SEPARATOR . $previous;
            if (is_file($previousAbs)) {
                @unlink($previousAbs);
            }
        }

        $this->db->execute('UPDATE usuario SET pdf_contrato = ? WHERE id = ?', [$relative, $id]);

        return [
            'ok' => true,
            'mensaje' => 'PDF de contrato cargado correctamente',
            'ruta' => $relative,
            'nombre' => basename((string)($file['name'] ?? $filename)),
            'tamano' => (int)($file['size'] ?? 0),
        ];
    }

    private function downloadContract(array $payload, int $id, bool $inline): array
    {
        if (!$this->canAccess($payload, $id)) {
            throw new RuntimeException('Acceso denegado', 403);
        }

        $user = $this->db->fetchOne('SELECT nombre, pdf_contrato FROM usuario WHERE id = ?', [$id]);
        if (!$user) {
            throw new RuntimeException('Usuario no encontrado', 404);
        }

        $relative = trim((string)($user['pdf_contrato'] ?? ''));
        if ($relative === '') {
            throw new RuntimeException('Este vendedor no tiene contrato cargado', 404);
        }

        $absolute = $this->rootPath() . DIRECTORY_SEPARATOR . $relative;
        if (!is_file($absolute)) {
            $this->db->execute('UPDATE usuario SET pdf_contrato = NULL WHERE id = ?', [$id]);
            throw new RuntimeException('Archivo PDF no encontrado en disco', 404);
        }

        $content = file_get_contents($absolute);
        if ($content === false) {
            throw new RuntimeException('Error al leer el contrato', 500);
        }

        $nombre = str_replace(' ', '_', trim((string)($user['nombre'] ?? 'vendedor')));
        return [
            'stream' => true,
            'contentType' => 'application/pdf',
            'disposition' => ($inline ? 'inline' : 'attachment') . '; filename="contrato_' . $nombre . '.pdf"',
            'bytes' => $content,
        ];
    }

    private function deleteContract(array $payload, int $id): array
    {
        if (!$this->isAdmin($payload)) {
            throw new RuntimeException('Acceso denegado', 403);
        }

        $user = $this->db->fetchOne('SELECT pdf_contrato FROM usuario WHERE id = ?', [$id]);
        if (!$user) {
            throw new RuntimeException('Usuario no encontrado', 404);
        }

        $relative = trim((string)($user['pdf_contrato'] ?? ''));
        if ($relative === '') {
            throw new RuntimeException('No hay contrato que eliminar', 404);
        }

        $absolute = $this->rootPath() . DIRECTORY_SEPARATOR . $relative;
        if (is_file($absolute)) {
            @unlink($absolute);
        }

        $this->db->execute('UPDATE usuario SET pdf_contrato = NULL WHERE id = ?', [$id]);

        return ['ok' => true, 'mensaje' => 'Contrato eliminado correctamente'];
    }

    private function updateRut(array $payload, int $id, array $body): array
    {
        if (!$this->canAccess($payload, $id)) {
            throw new RuntimeException('Acceso denegado', 403);
        }

        $rut = trim((string)($body['rut'] ?? ''));
        if ($rut === '' || mb_strlen($rut) < 8) {
            throw new RuntimeException('RUT inválido', 400);
        }

        $this->db->execute('UPDATE usuario SET rut = ? WHERE id = ?', [$rut, $id]);
        return ['ok' => true, 'mensaje' => 'RUT actualizado correctamente'];
    }

    private function getInfo(array $payload, int $id): array
    {
        if (!$this->canAccess($payload, $id)) {
            throw new RuntimeException('Acceso denegado', 403);
        }

        $row = $this->db->fetchOne(
            "SELECT id, nombre, email, codigo, area, rut,
                    CASE WHEN pdf_contrato IS NOT NULL THEN 1 ELSE 0 END AS tiene_contrato,
                    pdf_contrato
             FROM usuario
             WHERE id = ?",
            [$id]
        );

        if (!$row) {
            throw new RuntimeException('Usuario no encontrado', 404);
        }

        return ['ok' => true, 'data' => $row];
    }

    private function cleanupFile(string $path): void
    {
        if ($path !== '' && is_file($path)) {
            @unlink($path);
        }
    }
}
