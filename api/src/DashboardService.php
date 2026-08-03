<?php
declare(strict_types=1);

final class DashboardService
{
    public function __construct(private Database $db)
    {
    }

    public function route(array $payload, string $method, string $path, array $query, array $body): array
    {
        if ($method === 'GET' && $path === '/categorias-vendedor') {
            $result = $this->categoriasVendedor($payload, $query);
            return ['ok' => true, 'vendedores' => $result['vendedores'], 'todasLasCategorias' => $result['todasLasCategorias']];
        }

        return match (true) {
            $method === 'GET' && $path === '/asignados' => ['ok' => true, 'asignados' => $this->asignados($payload, $query)],
            $method === 'GET' && $path === '/compartir/lista' => ['ok' => true, 'folios' => $this->compartirLista($payload, $query)],
            $method === 'POST' && $path === '/compartir' => $this->compartir($payload, $body),
            $method === 'PUT' && preg_match('#^/compartir/(\d+)$#', $path, $m) => $this->actualizarCompartido($payload, (int)$m[1], $body),
            $method === 'DELETE' && preg_match('#^/compartir/(\d+)$#', $path, $m) => $this->eliminarCompartido($payload, (int)$m[1]),
            $method === 'GET' && $path === '/compartidos' => ['ok' => true, 'compartidos' => $this->compartidos($payload, $query)],
            $method === 'GET' && $path === '/clientes-resumen' => ['ok' => true, 'clientes' => $this->clientesResumen($payload, $query)],
            default => throw new RuntimeException('Ruta de dashboard no encontrada', 404),
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

    private function vendorCodes(array $payload): array
    {
        $userId = $this->currentUserId($payload);
        $rows = $this->db->fetchAll('SELECT cod_vendedor, tipo FROM usuario_vendedor WHERE usuario_id = ?', [$userId]);
        return array_values(array_filter(array_map(static fn(array $row): string => trim((string)($row['cod_vendedor'] ?? '')), $rows)));
    }

    private function coordinatorCodes(array $payload): array
    {
        $userId = $this->currentUserId($payload);
        $rows = $this->db->fetchAll('SELECT cod_vendedor, tipo FROM usuario_vendedor WHERE usuario_id = ?', [$userId]);
        return array_values(array_filter(array_map(static function (array $row): string {
            $tipo = strtoupper(trim((string)($row['tipo'] ?? '')));
            return $tipo === 'C' ? trim((string)($row['cod_vendedor'] ?? '')) : '';
        }, $rows)));
    }

    private function monthYear(array $query): array
    {
        return Security::validate_mes_anio($query['mes'] ?? null, $query['anio'] ?? null);
    }

    private function monthStart(int $anio, int $mes): string
    {
        return sprintf('%04d-%02d-01', $anio, $mes);
    }

    private function monthEnd(int $anio, int $mes): string
    {
        return (new DateTimeImmutable($this->monthStart($anio, $mes)))->modify('last day of this month')->format('Y-m-d');
    }

    private function toMssqlIn(array $values): string
    {
        return implode(',', array_map(static fn(string $v): string => "'" . str_replace("'", "''", $v) . "'", $values));
    }

    private function getSoftlandRowByFolioAndCoordinator(int $folio, array $codigosCoord): ?array
    {
        if (!$codigosCoord) {
            return null;
        }

        $placeholders = implode(',', array_fill(0, count($codigosCoord), '?'));
        $sql = "
            SELECT TOP 1 h.Folio, h.Fecha, h.CodVendedor, c.NomAux AS cliente,
                   SUM(m.TotLinea) AS montoBase
            FROM [PRODIN].[softland].[iw_gsaen] h
            LEFT JOIN [PRODIN].[softland].[cwtauxi] c ON c.CodAux = h.CodAux
            INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = h.NroInt AND m.Tipo = h.Tipo
            WHERE h.Folio = ?
              AND h.CodVendedor IN ($placeholders)
              AND h.Tipo IN ('F','N','D') AND h.Estado <> 'A'
            GROUP BY h.Folio, h.Fecha, h.CodVendedor, c.NomAux
        ";
        $params = array_merge([$folio], $codigosCoord);
        $stmt = $this->db->softland()->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
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
        if ($row) {
            return (int)$row['usuario_id'];
        }

        $codPadded = str_pad($cod, 2, '0', STR_PAD_LEFT);
        $codUnpadded = ltrim($cod, '0');
        $codUnpadded = $codUnpadded === '' ? '0' : $codUnpadded;
        $row = $this->db->fetchOne(
            'SELECT usuario_id FROM usuario_vendedor WHERE TRIM(cod_vendedor) IN (?, ?) LIMIT 1',
            [$codPadded, $codUnpadded]
        );
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

    private function validatePositiveId(mixed $value, string $label = 'ID'): int
    {
        $id = (int)$value;
        if ($id <= 0) {
            throw new RuntimeException($label . ' inválido', 400);
        }
        return $id;
    }

    private function compartirLista(array $payload, array $query): array
    {
        $codigosCoord = $this->coordinatorCodes($payload);
        if (!$codigosCoord) {
            throw new RuntimeException('No autorizado para compartir', 403);
        }

        $periodo = $this->monthYear($query);
        $mes = $periodo['mes'];
        $anio = $periodo['anio'];

        $placeholders = implode(',', array_fill(0, count($codigosCoord), '?'));
        $foliosYaAsignados = $this->db->fetchAll(
            "SELECT DISTINCT folio
             FROM factura_compartida
             WHERE cod_vendedor_principal IN ($placeholders)
               AND rol = 'compartido'",
            $codigosCoord
        );
        $exclude = array_map(static fn(array $row): int => (int)$row['folio'], $foliosYaAsignados);
        $excludeSql = $exclude ? ' AND h.Folio NOT IN (' . implode(',', array_map('intval', $exclude)) . ')' : '';

        $softland = $this->db->softland();
        $sql = "
            SELECT TOP 200
                h.Folio,
                CONVERT(varchar(10), h.Fecha, 103) AS fecha_formato,
                c.NomAux AS cliente,
                ROUND(SUM(m.TotLinea), 0) AS monto,
                h.CodVendedor
            FROM [PRODIN].[softland].[iw_gsaen] h
            LEFT JOIN [PRODIN].[softland].[cwtauxi] c ON c.CodAux = h.CodAux
            INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = h.NroInt AND m.Tipo = h.Tipo
            WHERE h.CodVendedor IN ($placeholders)
              AND MONTH(h.Fecha) = ?
              AND YEAR(h.Fecha) = ?
              AND h.Tipo IN ('F','N','D')
              AND h.Estado <> 'A'
              $excludeSql
            GROUP BY h.Folio, h.Fecha, c.NomAux, h.CodVendedor
            ORDER BY h.Fecha DESC
        ";
        $stmt = $softland->prepare($sql);
        $stmt->execute(array_merge($codigosCoord, [$mes, $anio]));
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
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
            "SELECT id, monto_neto, folio, cliente, mes, anio
             FROM factura_compartida
             WHERE id = ?
               AND cod_vendedor_principal IN ($placeholders)
             LIMIT 1",
            array_merge([$id], $codigosCoord)
        );
        if (!$row) {
            throw new RuntimeException('Asignación no encontrada', 404);
        }

        $montoAsignado = (int)round((float)($row['monto_neto'] ?? 0) * $porcentaje / 100);
        $nombreVendedorComp = $this->getNombreVendedor($codVendedorCompartido);
        $this->db->execute(
            'UPDATE factura_compartida
             SET cod_vendedor_compartido = ?, nombre_vendedor_compartido = ?, porcentaje = ?, monto_asignado = ?
             WHERE id = ?',
            [$codVendedorCompartido, $nombreVendedorComp, $porcentaje, $montoAsignado, $id]
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

    private function compartidos(array $payload, array $query): array
    {
        $codes = $this->vendorCodes($payload);
        if (!$codes) {
            return [];
        }

        $periodo = $this->monthYear($query);
        $mes = $periodo['mes'];
        $anio = $periodo['anio'];
        $placeholders = implode(',', array_fill(0, count($codes), '?'));
        return $this->db->fetchAll(
            "SELECT fc.id, fc.folio, fc.fecha, fc.mes, fc.anio, fc.cliente, fc.monto_neto, fc.monto_asignado, fc.porcentaje,
                    fc.cod_vendedor_principal, fc.cod_vendedor_compartido, fc.nombre_vendedor_compartido,
                    fc.monto_asignado AS monto, COALESCE(u.nombre, fc.cod_vendedor_principal) AS coordinador
             FROM factura_compartida fc
             LEFT JOIN usuario_vendedor uv ON uv.cod_vendedor = fc.cod_vendedor_principal
             LEFT JOIN usuario u ON u.id = uv.usuario_id
             WHERE fc.cod_vendedor_compartido IN ($placeholders)
               AND fc.mes = ?
               AND fc.anio = ?
               AND fc.rol = 'compartido'
             ORDER BY fc.fecha DESC",
            array_merge($codes, [$mes, $anio])
        );
    }

    private function asignados(array $payload, array $query): array
    {
        $codes = $this->coordinatorCodes($payload);
        if (!$codes) {
            return [];
        }

        $params = $codes;
        $sql = "
            SELECT fc.id, fc.folio, fc.fecha, fc.cliente, fc.monto_neto, fc.monto_asignado, fc.porcentaje,
                   fc.cod_vendedor_principal, fc.cod_vendedor_compartido, fc.nombre_vendedor_compartido,
                   fc.monto_asignado AS monto, COALESCE(u.nombre, fc.cod_vendedor_compartido) AS vendedor
            FROM factura_compartida fc
            LEFT JOIN usuario_vendedor uv ON uv.cod_vendedor = fc.cod_vendedor_compartido
            LEFT JOIN usuario u ON u.id = uv.usuario_id
            WHERE fc.cod_vendedor_principal IN (" . implode(',', array_fill(0, count($codes), '?')) . ")
              AND fc.rol = 'compartido'
        ";

        if (($query['mes'] ?? '') !== '' && ($query['anio'] ?? '') !== '') {
            $periodo = $this->monthYear($query);
            $sql .= ' AND fc.mes = ? AND fc.anio = ?';
            $params[] = $periodo['mes'];
            $params[] = $periodo['anio'];
        }
        $sql .= ' ORDER BY fc.fecha DESC';

        return $this->db->fetchAll($sql, $params);
    }

    private function categoriasVendedor(array $payload, array $query): array
    {
        $codes = $this->vendorCodes($payload);
        if (!$codes) {
            return ['vendedores' => [], 'todasLasCategorias' => []];
        }

        $periodo = $this->monthYear($query);
        $mes = $periodo['mes'];
        $anio = $periodo['anio'];
        $catRows = $this->db->fetchAll('SELECT Cta, Categoria FROM categoriasproducto');
        $catMap = [];
        foreach ($catRows as $row) {
            $catMap[(string)$row['Cta']] = (string)$row['Categoria'];
        }

        $softland = $this->db->softland();
        $resultado = [];
        foreach ($codes as $cod) {
            $stmt = $softland->prepare("
                SELECT t.CtaVentas, SUM(m.TotLinea) AS TotalVentas
                FROM [PRODIN].[softland].[iw_gsaen] h
                INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = h.NroInt AND m.Tipo = h.Tipo
                INNER JOIN [PRODIN].[softland].[iw_tprod] t ON t.CodProd = m.CodProd
                WHERE h.CodVendedor = ?
                  AND h.Tipo IN ('F','N','D')
                  AND h.Estado <> 'A'
                  AND h.Fecha >= ?
                  AND h.Fecha < DATEADD(MONTH, 1, ?)
                  AND t.CtaVentas IS NOT NULL
                GROUP BY t.CtaVentas
                ORDER BY TotalVentas DESC
            ");
            $stmt->execute([$cod, $this->monthStart($anio, $mes), $this->monthStart($anio, $mes)]);
            $agg = [];
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                $cat = $catMap[(string)($row['CtaVentas'] ?? '')] ?? 'Otros';
                $agg[$cat] = ($agg[$cat] ?? 0) + (float)($row['TotalVentas'] ?? 0);
            }
            $categorias = [];
            foreach ($agg as $categoria => $total) {
                $categorias[] = ['categoria' => $categoria, 'total' => (int)round($total)];
            }
            usort($categorias, static fn(array $a, array $b): int => $b['total'] <=> $a['total']);
            $resultado[] = ['codVendedor' => $cod, 'categorias' => $categorias];
        }

        return [
            'vendedores' => $resultado,
            'todasLasCategorias' => array_values(array_unique(array_map(static fn(array $r): string => (string)$r['Categoria'], $catRows))),
        ];
    }

    private function clientesResumen(array $payload, array $query): array
    {
        $codes = $this->vendorCodes($payload);
        if (!$codes) {
            return [];
        }

        $periodo = $this->monthYear($query);
        $mes = $periodo['mes'];
        $anio = $periodo['anio'];
        $softland = $this->db->softland();
        $resultado = [];
        foreach ($codes as $cod) {
            $stmt = $softland->prepare("
                SELECT
                  ? AS CodVendedor,
                  (SELECT COUNT(DISTINCT CodAux)
                   FROM [PRODIN].[softland].[iw_gsaen]
                   WHERE CodVendedor = ?
                     AND Tipo IN ('F','N','D')
                     AND Estado <> 'A') AS TotalClientesHist,
                  (SELECT COUNT(DISTINCT CodAux)
                   FROM [PRODIN].[softland].[iw_gsaen]
                   WHERE CodVendedor = ?
                     AND Tipo IN ('F','N','D')
                     AND Estado <> 'A'
                     AND Fecha >= ?
                     AND Fecha < DATEADD(MONTH, 1, ?)) AS TotalClientesPeriodo
            ");
            $stmt->execute([$cod, $cod, $cod, $this->monthStart($anio, $mes), $this->monthStart($anio, $mes)]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($row) {
                $resultado[] = [
                    'codVendedor' => (string)$row['CodVendedor'],
                    'totalClientesHist' => (int)($row['TotalClientesHist'] ?? 0),
                    'totalClientesPeriodo' => (int)($row['TotalClientesPeriodo'] ?? 0),
                ];
            }
        }

        return $resultado;
    }
}
