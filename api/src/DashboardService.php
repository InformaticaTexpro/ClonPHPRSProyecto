<?php
declare(strict_types=1);

require_once __DIR__ . '/VentaCompartidaAssignmentService.php';

final class DashboardService
{
    use SharedServiceHelpers;

    public function __construct(private Database $db)
    {
    }

    public function route(array $payload, string $method, string $path, array $query, array $body): array
    {
        return match (true) {
            $method === 'POST' && $path === '/compartir' => $this->compartir($payload, $body),
            $method === 'PUT' && preg_match('#^/compartir/(\d+)$#', $path, $m) => $this->actualizarCompartido($payload, (int)$m[1], $body),
            $method === 'DELETE' && preg_match('#^/compartir/(\d+)$#', $path, $m) => $this->eliminarCompartido($payload, (int)$m[1]),
            default => throw new RuntimeException('Ruta de dashboard no encontrada', 404),
        };
    }

    private function compartir(array $payload, array $body): array
    {
        $codes = $this->coordinatorCodes($payload);
        if (!$codes) throw new RuntimeException('No autorizado', 403);
        return (new VentaCompartidaAssignmentService($this->db))->crear($payload, $body, $codes);
    }

    private function actualizarCompartido(array $payload, int $id, array $body): array
    {
        $codes = $this->coordinatorCodes($payload);
        if (!$codes) throw new RuntimeException('No autorizado', 403);
        return (new VentaCompartidaAssignmentService($this->db))->actualizar($payload, $id, $body, $codes);
    }

    private function eliminarCompartido(array $payload, int $id): array
    {
        $codigosCoord = $this->coordinatorCodes($payload);
        if (!$codigosCoord) {
            throw new RuntimeException('No autorizado', 403);
        }

        $placeholders = implode(',', array_fill(0, count($codigosCoord), '?'));
        $row = $this->db->fetchOne(
            "SELECT id FROM factura_compartida WHERE id = ? AND cod_vendedor_principal IN ($placeholders) LIMIT 1",
            array_merge([$id], $codigosCoord)
        );
        if (!$row) {
            throw new RuntimeException('Asignación no encontrada o sin permiso', 404);
        }

        $this->db->execute('DELETE FROM factura_compartida WHERE id = ?', [$id]);
        return ['ok' => true, 'message' => 'Asignación eliminada. El folio está disponible nuevamente.'];
    }
}
