<?php
declare(strict_types=1);

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

    private function getSoftlandRowByFolioAndCoordinator(int $folio, array $codigosCoord): ?array
    {
        if (!$codigosCoord) {
            return null;
        }

        $placeholders = implode(',', array_fill(0, count($codigosCoord), '?'));
        $saleExpression = $this->commercialAmountSql('h.Tipo', 'm.TotLinea');
        $sql = "
            SELECT TOP 1 h.Folio, h.Fecha, h.Tipo, h.CodVendedor, h.CodAux,
                   COALESCE(
                       NULLIF(LTRIM(RTRIM(CONVERT(varchar(max), c.NomAux))), ''),
                       NULLIF(LTRIM(RTRIM(h.CodAux)), '')
                   ) AS cliente,
                   SUM($saleExpression) AS montoBase
            FROM [PRODIN].[softland].[iw_gsaen] h
            LEFT JOIN [PRODIN].[softland].[cwtauxi] c ON c.CodAux = h.CodAux
            INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = h.NroInt AND m.Tipo = h.Tipo
            WHERE h.Folio = ?
              AND h.CodVendedor IN ($placeholders)
              AND h.Tipo IN ('F','N','D') AND h.Estado <> 'A'
            GROUP BY h.Folio, h.Fecha, h.Tipo, h.CodVendedor, h.CodAux, CONVERT(varchar(max), c.NomAux)
        ";
        $params = array_merge([$folio], $codigosCoord);
        $stmt = $this->db->softland()->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            return null;
        }

        $row['cliente'] = trim((string)($row['cliente'] ?? ''));
        if ($row['cliente'] === '') {
            $row['cliente'] = trim((string)($row['CodAux'] ?? ''));
        }
        return $row;
    }

    private function getNombreVendedor(string $codVendedor): string
    {
        try {
            $row = $this->db->fetchOne(
                'SELECT u.nombre
                 FROM usuario_vendedor uv
                 INNER JOIN usuario u ON u.id = uv.usuario_id
                 WHERE uv.cod_vendedor = ?
                 LIMIT 1',
                [$codVendedor]
            );
            return trim((string)($row['nombre'] ?? $codVendedor)) ?: $codVendedor;
        } catch (Throwable) {
            return $codVendedor;
        }
    }

    private function usuarioIdDesdeCodVendedor(string $codVendedor): ?int
    {
        $cod = trim($codVendedor);
        if ($cod === '') {
            return null;
        }

        $row = $this->db->fetchOne('SELECT usuario_id FROM usuario_vendedor WHERE TRIM(cod_vendedor) = ? LIMIT 1', [$cod]);
        return $row ? (int)$row['usuario_id'] : null;
    }

    private function notifyUser(int $usuarioId, string $tipo, string $titulo, string $mensaje, ?int $folio, ?int $mes, ?int $anio): void
    {
        if ($usuarioId <= 0) {
            return;
        }
        $this->db->execute(
            'INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, leida, folio, mes, anio, fecha_creacion)
             VALUES (?, ?, ?, ?, 0, ?, ?, ?, NOW())',
            [$usuarioId, $tipo, $titulo, $mensaje, $folio, $mes, $anio]
        );
    }

    private function monthFromSql(mixed $fecha): array
    {
        $iso = $fecha instanceof DateTimeInterface ? $fecha->format('Y-m-d') : substr((string)$fecha, 0, 10);
        [$anio, $mes] = array_map('intval', explode('-', $iso));
        return ['mes' => $mes, 'anio' => $anio, 'iso' => $iso];
    }

    private function assertSharedPercentageAvailable(
        string $folio,
        string $originCode,
        int $mes,
        int $anio,
        float $percentage,
        ?int $excludeId = null
    ): void {
        $sql = "SELECT COALESCE(SUM(porcentaje), 0) AS porcentaje_asignado
                FROM factura_compartida
                WHERE folio = ?
                  AND TRIM(cod_vendedor_principal) = TRIM(?)
                  AND mes = ?
                  AND anio = ?
                  AND rol = 'compartido'";
        $params = [$folio, $originCode, $mes, $anio];
        if ($excludeId !== null) {
            $sql .= ' AND id <> ?';
            $params[] = $excludeId;
        }
        $assigned = (float)($this->db->fetchOne($sql, $params)['porcentaje_asignado'] ?? 0);
        if ($assigned + $percentage > 100.000001) {
            throw new RuntimeException('La suma de participaciones del documento no puede superar 100%.', 400);
        }
    }

    private function compartir(array $payload, array $body): array
    {
        $codigosCoord = $this->coordinatorCodes($payload);
        if (!$codigosCoord) {
            throw new RuntimeException('No autorizado', 403);
        }

        $folio = Security::validate_folio($body['folio'] ?? null);
        $codVendedorCompartido = Security::validate_cod_vendedor($body['cod_vendedor_compartido'] ?? null);
        $porcentaje = Security::validate_porcentaje($body['porcentaje'] ?? null);

        $f = $this->getSoftlandRowByFolioAndCoordinator($folio, $codigosCoord);
        if (!$f) {
            throw new RuntimeException('Folio no encontrado o no autorizado', 404);
        }

        $montoBase = (float)($f['montoBase'] ?? 0);
        $montoAsignado = (int)round($montoBase * $porcentaje / 100);
        $fecha = $this->monthFromSql($f['Fecha'] ?? null);
        $this->assertSharedPercentageAvailable(
            (string)$folio,
            (string)($f['CodVendedor'] ?? ''),
            $fecha['mes'],
            $fecha['anio'],
            (float)$porcentaje
        );
        $nombreVendedorComp = $this->getNombreVendedor($codVendedorCompartido);
        $nombreCoordinador = trim((string)($payload['nombre'] ?? '')) ?: ('Coordinador (' . ($f['CodVendedor'] ?? '') . ')');

        $this->db->execute(
            'INSERT INTO factura_compartida
              (folio, anio, mes, fecha, cliente, monto_neto, monto_asignado, porcentaje, rol,
               cod_vendedor_principal, cod_vendedor_compartido, nombre_vendedor_compartido, fecha_registro, usuario_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, \'compartido\', ?, ?, ?, NOW(), ?)',
            [
                (string)$folio,
                $fecha['anio'],
                $fecha['mes'],
                $fecha['iso'],
                (string)($f['cliente'] ?? ''),
                $montoBase,
                $montoAsignado,
                $porcentaje,
                (string)($f['CodVendedor'] ?? ''),
                $codVendedorCompartido,
                $nombreVendedorComp,
                $this->currentUserId($payload),
            ]
        );

        $usuarioIdReceptor = $this->usuarioIdDesdeCodVendedor($codVendedorCompartido);
        if ($usuarioIdReceptor) {
            $this->notifyUser(
                $usuarioIdReceptor,
                'folio_recibido',
                sprintf('📥 Folio #%d asignado a ti', $folio),
                sprintf(
                    'El coordinador %s te asignó el folio #%d (%s) por $%s con un %d%% de participación.',
                    $nombreCoordinador,
                    $folio,
                    (string)($f['cliente'] ?? ''),
                    number_format($montoAsignado, 0, ',', '.'),
                    $porcentaje
                ),
                $folio,
                $fecha['mes'],
                $fecha['anio']
            );
        }

        $this->notifyUser(
            $this->currentUserId($payload),
            'folio_asignado',
            sprintf('✅ Folio #%d compartido con %s', $folio, $nombreVendedorComp),
            sprintf('El folio #%d (%s) fue asignado a %s con un %d%% de participación.', $folio, (string)($f['cliente'] ?? ''), $nombreVendedorComp, $porcentaje),
            $folio,
            $fecha['mes'],
            $fecha['anio']
        );

        return ['ok' => true, 'message' => 'Folio compartido correctamente'];
    }

    private function actualizarCompartido(array $payload, int $id, array $body): array
    {
        $codigosCoord = $this->coordinatorCodes($payload);
        if (!$codigosCoord) {
            throw new RuntimeException('No autorizado', 403);
        }

        $codVendedorCompartido = Security::validate_cod_vendedor($body['cod_vendedor_compartido'] ?? null);
        $porcentaje = Security::validate_porcentaje($body['porcentaje'] ?? null);

        $placeholders = implode(',', array_fill(0, count($codigosCoord), '?'));
        $row = $this->db->fetchOne(
            "SELECT id, monto_neto, folio, cliente, mes, anio, cod_vendedor_principal
             FROM factura_compartida
             WHERE id = ?
               AND cod_vendedor_principal IN ($placeholders)
             LIMIT 1",
            array_merge([$id], $codigosCoord)
        );
        if (!$row) {
            throw new RuntimeException('Asignación no encontrada', 404);
        }

        $this->assertSharedPercentageAvailable(
            (string)$row['folio'],
            (string)($row['cod_vendedor_principal'] ?? ''),
            (int)$row['mes'],
            (int)$row['anio'],
            (float)$porcentaje,
            $id
        );

        $softlandRow = $this->getSoftlandRowByFolioAndCoordinator(
            (int)$row['folio'],
            [(string)($row['cod_vendedor_principal'] ?? '')]
        );
        $montoBase = (float)($softlandRow['montoBase'] ?? $row['monto_neto'] ?? 0);
        $montoAsignado = (int)round($montoBase * $porcentaje / 100);
        $nombreVendedorComp = $this->getNombreVendedor($codVendedorCompartido);
        $this->db->execute(
            'UPDATE factura_compartida
             SET cod_vendedor_compartido = ?, nombre_vendedor_compartido = ?, porcentaje = ?, monto_neto = ?, monto_asignado = ?
             WHERE id = ?',
            [$codVendedorCompartido, $nombreVendedorComp, $porcentaje, $montoBase, $montoAsignado, $id]
        );

        $usuarioIdReceptor = $this->usuarioIdDesdeCodVendedor($codVendedorCompartido);
        if ($usuarioIdReceptor) {
            $this->notifyUser(
                $usuarioIdReceptor,
                'folio_recibido',
                sprintf('📥 Folio #%d asignado a ti', (int)$row['folio']),
                sprintf('El coordinador %s te asignó el folio #%d (%s) por $%s con un %d%% de participación.', (string)($payload['nombre'] ?? 'Coordinador'), (int)$row['folio'], (string)($row['cliente'] ?? ''), number_format($montoAsignado, 0, ',', '.'), $porcentaje),
                (int)$row['folio'],
                (int)$row['mes'],
                (int)$row['anio']
            );
        }

        $this->notifyUser(
            $this->currentUserId($payload),
            'folio_asignado',
            sprintf('✅ Folio #%d compartido con %s', (int)$row['folio'], $nombreVendedorComp),
            sprintf('El folio #%d (%s) fue asignado a %s con un %d%% de participación.', (int)$row['folio'], (string)($row['cliente'] ?? ''), $nombreVendedorComp, $porcentaje),
            (int)$row['folio'],
            (int)$row['mes'],
            (int)$row['anio']
        );

        return ['ok' => true, 'message' => 'Asignación actualizada'];
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
