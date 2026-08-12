<?php
declare(strict_types=1);

final class VentasService
{
    use SharedServiceHelpers;

    public function __construct(
        private Database $db,
        private AnalyticsService $analytics,
        private ?SoftlandBridgeClient $bridgeClient = null
    ) {
    }

    private function bridgeEnabled(): bool
    {
        return $this->bridgeClient instanceof SoftlandBridgeClient
            && $this->bridgeClient->isEnabled();
    }

    private function bridgeGet(string $path, array $query): array
    {
        if (!$this->bridgeClient instanceof SoftlandBridgeClient) {
            throw new RuntimeException('Softland bridge no disponible.', 503);
        }
        $this->bridgeClient->assertEnabledAndConfigured();
        return $this->bridgeClient->get($path, $query);
    }

    public function route(array $payload, string $method, string $path, array $query, array $body): array
    {
        return match (true) {
            $method === 'GET' && $path === '/' => $this->ventas($payload, $query),
            $method === 'GET' && $path === '/kpis' => $this->kpis($payload, $query),
            $method === 'GET' && $path === '/total' => $this->total($payload, $query),
            $method === 'GET' && $path === '/resumen' => $this->resumen($payload, $query),
            $method === 'GET' && $path === '/resumen-vendedores' => $this->resumenVendedores($payload, $query),
            $method === 'GET' && $path === '/evolucion' => $this->evolucion($payload, $query),
            $method === 'GET' && $path === '/meta' => $this->meta($payload, $query),
            $method === 'GET' && $path === '/clientes' => $this->clientes($payload, $query),
            $method === 'GET' && $path === '/cliente-info' => $this->clienteInfo($payload, $query),
            $method === 'GET' && $path === '/historial-cliente' => $this->historialCliente($payload, $query),
            $method === 'GET' && preg_match('#^/folio/([^/]+)$#', $path, $m) => $this->folio($payload, $m[1], $query),
            $method === 'GET' && preg_match('#^/detalle/([^/]+)$#', $path, $m) => $this->detalle($payload, $m[1], $query),
            $method === 'GET' && $path === '/descuentos' => $this->descuentos($payload, $query),
            default => throw new RuntimeException('Ruta de ventas no encontrada', 404),
        };
    }

    private function buildCarteraExistsClause(string $codigosIn, string $aliasCliente = 'c'): string
    {
        return "
            EXISTS (
              SELECT 1
              FROM [PRODIN].[softland].[cwtauxven] av
              WHERE av.CodAux = {$aliasCliente}.CodAux
                AND av.VenCod IN ({$codigosIn})
            )
        ";
    }

    private function ventas(array $payload, array $query): array
    {
        $codigos = $this->vendorCodes($payload);
        if (!$codigos) {
            return ['ok' => true, 'ventas' => []];
        }
        $periodo = $this->monthYear($query);
        $ventas = $this->analytics->ventasMes($payload, $query)['ventas'] ?? [];
        return ['ok' => true, 'ventas' => $ventas];
    }

    private function kpis(array $payload, array $query): array
    {
        $codigos = $this->vendorCodes($payload);
        $periodo = $this->monthYear($query);
        $meta = $this->analytics->resumen($payload, $query);

        if (!$codigos) {
            return ['ok' => true, 'totalVentas' => 0, 'metaMes' => (int)($meta['meta'] ?? 0), 'totalDescuento' => 0];
        }

        if ($this->bridgeEnabled()) {
            $bridge = $this->bridgeGet('/dashboard/resumen', [
                'codigos' => implode(',', $codigos),
                'mes' => $periodo['mes'],
                'anio' => $periodo['anio'],
            ]);
            $totalVentas = (float)($bridge['totalVentasCobrado'] ?? 0);
            $totalLista = (float)($bridge['totalVentasLista'] ?? 0);

            return [
                'ok' => true,
                'totalVentas' => (int)round($totalVentas),
                'metaMes' => (int)round((float)($meta['meta'] ?? 0)),
                'totalDescuento' => (int)round($totalLista - $totalVentas),
            ];
        }

        $softland = $this->asSoftlandPool();
        $stmt = $softland->prepare(
            "SELECT
                SUM(m.TotLinea) AS totalVentasCobrado,
                SUM(m.CantFacturada * ISNULL(t.PrecioVta, 0)) AS totalVentasLista
             FROM [PRODIN].[softland].[iw_gsaen] enc
             INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = enc.NroInt AND m.Tipo = enc.Tipo
             INNER JOIN [PRODIN].[softland].[iw_tprod] t ON t.CodProd = m.CodProd
             LEFT JOIN [PRODIN].[softland].[cwtcvcl] cvl ON cvl.CodAux = enc.CodAux
             WHERE enc.Tipo IN ('F','N','D')
               AND enc.Estado <> 'A'
               AND enc.CodVendedor IN (" . implode(',', array_fill(0, count($codigos), '?')) . ")
               AND MONTH(enc.Fecha) = ?
               AND YEAR(enc.Fecha) = ?"
        );
        $stmt->execute(array_merge($codigos, [$periodo['mes'], $periodo['anio']]));
        $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
        $totalVentas = (float)($row['totalVentasCobrado'] ?? 0);
        $totalLista = (float)($row['totalVentasLista'] ?? 0);
        $totalDescuento = (int)round($totalLista - $totalVentas);

        return [
            'ok' => true,
            'totalVentas' => (int)round($totalVentas),
            'metaMes' => (int)round((float)($meta['meta'] ?? 0)),
            'totalDescuento' => $totalDescuento,
        ];
    }

    private function total(array $payload, array $query): array
    {
        $codigos = $this->vendorCodes($payload);
        if (!$codigos) {
            return ['ok' => true, 'total_ventas' => 0];
        }
        $periodo = $this->monthYear($query);

        if ($this->bridgeEnabled()) {
            $bridge = $this->bridgeGet('/dashboard/resumen', [
                'codigos' => implode(',', $codigos),
                'mes' => $periodo['mes'],
                'anio' => $periodo['anio'],
            ]);
            return ['ok' => true, 'total_ventas' => (int)($bridge['totalVentasCobrado'] ?? 0)];
        }

        $softland = $this->asSoftlandPool();
        $stmt = $softland->prepare(
            "SELECT SUM(m.TotLinea) AS total_ventas
             FROM [PRODIN].[softland].[iw_gmovi] m
             INNER JOIN [PRODIN].[softland].[iw_gsaen] enc
               ON enc.NroInt = m.NroInt AND enc.Tipo = m.Tipo
             WHERE enc.Tipo IN ('F','N','D')
               AND enc.Estado <> 'A'
               AND enc.CodVendedor IN (" . implode(',', array_fill(0, count($codigos), '?')) . ")
               AND MONTH(enc.Fecha) = ?
               AND YEAR(enc.Fecha) = ?"
        );
        $stmt->execute(array_merge($codigos, [$periodo['mes'], $periodo['anio']]));
        $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
        return ['ok' => true, 'total_ventas' => (int)round((float)($row['total_ventas'] ?? 0))];
    }

    private function resumen(array $payload, array $query): array
    {
        $data = $this->analytics->resumen($payload, $query);
        return ['ok' => true, 'resumen' => $data];
    }

    private function resumenVendedores(array $payload, array $query): array
    {
        $data = $this->analytics->vendedores($payload, $query);
        return ['ok' => true, 'vendedores' => $data['vendedores'] ?? []];
    }

    private function evolucion(array $payload, array $query): array
    {
        $data = $this->analytics->evolucion($payload, $query);
        return ['ok' => true, 'evolucion' => $data['evolucion'] ?? []];
    }

    private function meta(array $payload, array $query): array
    {
        $periodo = $this->monthYear($query);
        $userId = $this->currentUserId($payload);
        $meta = $this->db->fetchOne(
            'SELECT meta, tipo_periodo, fecha, activo
             FROM vendedor_meta
             WHERE usuario_id = ?
             ORDER BY activo DESC, fecha DESC, id DESC
             LIMIT 1',
            [$userId]
        );
        return [
            'ok' => true,
            'metaAnual' => (int)round((float)($meta['meta'] ?? 0)),
            'metaMes' => (int)round((float)($meta['meta'] ?? 0)),
            'tipo_periodo' => $meta['tipo_periodo'] ?? null,
            'fecha' => isset($meta['fecha']) ? substr((string)$meta['fecha'], 0, 10) : null,
            'prorrateada' => false,
            'mes' => $periodo['mes'],
            'anio' => $periodo['anio'],
        ];
    }

    private function clientes(array $payload, array $query): array
    {
        $q = trim((string)($query['q'] ?? ''));
        if (mb_strlen($q) < 2) {
            return ['ok' => true, 'clientes' => []];
        }

        $codigos = $this->vendorCodes($payload);
        if (!$codigos) {
            return ['ok' => true, 'clientes' => []];
        }

        if ($this->bridgeEnabled()) {
            return $this->bridgeGet('/ventas/clientes', [
                'q' => $q,
                'codigos' => implode(',', $codigos),
            ]);
        }

        $softland = $this->asSoftlandPool();
        $params = [];
        $in = $this->buildInClause($codigos, $params);
        $qSafe = str_replace(['%', '_', '[', ']'], ['[%]', '[_]', '[[]', '[]]'], $q);
        $stmt = $softland->prepare(
            "SELECT TOP 40
                c.CodAux,
                COALESCE(NULLIF(LTRIM(RTRIM(c.NomAux)), ''), RTRIM(c.CodAux)) AS NomAux,
                RTRIM(c.FonAux1) AS FonAux1,
                RTRIM(c.FonAux2) AS FonAux2,
                RTRIM(c.EMail) AS Email
             FROM [PRODIN].[softland].[cwtauxi] c
             WHERE (RTRIM(c.NomAux) LIKE ? OR c.CodAux LIKE ?)
               AND {$this->buildCarteraExistsClause($in)}
             ORDER BY COALESCE(NULLIF(LTRIM(RTRIM(c.NomAux)), ''), RTRIM(c.CodAux))"
        );
        $stmt->execute(array_merge(["%{$qSafe}%", "%{$qSafe}%"], $codigos));
        return ['ok' => true, 'clientes' => $stmt->fetchAll(PDO::FETCH_ASSOC)];
    }

    private function clienteInfo(array $payload, array $query): array
    {
        $codAux = trim((string)($query['codAux'] ?? ''));
        if ($codAux === '') {
            throw new RuntimeException('Parámetro codAux requerido', 400);
        }

        $codigos = $this->vendorCodes($payload);
        if (!$codigos) {
            throw new RuntimeException('Sin permiso para este cliente', 403);
        }

        if ($this->bridgeEnabled()) {
            return $this->bridgeGet('/ventas/cliente-info', [
                'codAux' => $codAux,
                'codigos' => implode(',', $codigos),
            ]);
        }

        $softland = $this->asSoftlandPool();
        $in = implode(',', array_fill(0, count($codigos), '?'));
        $stmt = $softland->prepare(
            "SELECT TOP 1
                RTRIM(c.CodAux) AS rut,
                COALESCE(NULLIF(LTRIM(RTRIM(c.NomAux)), ''), RTRIM(c.CodAux)) AS nombre,
                RTRIM(c.FonAux1) AS telefono,
                RTRIM(c.FonAux2) AS telefono2,
                RTRIM(c.DirAux) AS direccion,
                RTRIM(ciud.CiuDes) AS ciudad,
                RTRIM(c.EMail) AS email
             FROM [PRODIN].[softland].[cwtauxi] c
             LEFT JOIN [PRODIN].[softland].[cwtciud] ciud ON RTRIM(c.CiuAux) = RTRIM(ciud.CiuCod)
             WHERE c.CodAux = ?
               AND EXISTS (
                 SELECT 1
                 FROM [PRODIN].[softland].[cwtauxven] av
                 WHERE av.CodAux = c.CodAux
                   AND av.VenCod IN ($in)
               )"
        );
        $stmt->execute(array_merge([$codAux], $codigos));
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            throw new RuntimeException('Cliente no encontrado', 404);
        }
        return ['ok' => true, 'cliente' => $row];
    }

    private function historialCliente(array $payload, array $query): array
    {
        $codAux = trim((string)($query['codAux'] ?? ''));
        $desde = trim((string)($query['desde'] ?? ''));
        $hasta = trim((string)($query['hasta'] ?? ''));
        if ($codAux === '') {
            throw new RuntimeException('Parámetro codAux requerido', 400);
        }
        if ($desde === '' || $hasta === '') {
            throw new RuntimeException('Parámetros desde y hasta requeridos (YYYY-MM-DD)', 400);
        }
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $desde) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $hasta)) {
            throw new RuntimeException('Fechas deben ser YYYY-MM-DD', 400);
        }
        if ($desde > $hasta) {
            throw new RuntimeException('La fecha desde no puede ser mayor a hasta', 400);
        }

        $codigos = $this->vendorCodes($payload);
        if (!$codigos) {
            return ['ok' => true, 'historial' => []];
        }

        if ($this->bridgeEnabled()) {
            return $this->bridgeGet('/ventas/historial-cliente', [
                'codAux' => $codAux,
                'desde' => $desde,
                'hasta' => $hasta,
                'codigos' => implode(',', $codigos),
            ]);
        }

        $softland = $this->asSoftlandPool();
        $in = implode(',', array_fill(0, count($codigos), '?'));
        $stmt = $softland->prepare(
            "SELECT
                c.CodAux,
                COALESCE(NULLIF(LTRIM(RTRIM(c.NomAux)), ''), RTRIM(c.CodAux)) AS NomAux,
                RTRIM(c.FonAux1) AS FonAux1,
                RTRIM(c.FonAux2) AS FonAux2,
                RTRIM(c.EMail) AS Email,
                RTRIM(c.DirAux) AS Direccion,
                RTRIM(ciud.CiuDes) AS Ciudad,
                h.CodVendedor,
                CONVERT(varchar(10), h.Fecha, 120) AS Fecha,
                m.CodProd,
                CAST(m.DetProd AS varchar(max)) AS DetProd,
                m.TotLinea,
                YEAR(h.Fecha) AS Anio,
                MONTH(h.Fecha) AS Mes
             FROM [PRODIN].[softland].[iw_gsaen] h
             INNER JOIN [PRODIN].[softland].[cwtauxi] c ON c.CodAux = h.CodAux
             LEFT JOIN [PRODIN].[softland].[cwtciud] ciud ON RTRIM(c.CiuAux) = RTRIM(ciud.CiuCod)
             INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.Tipo = h.Tipo AND m.NroInt = h.NroInt
             WHERE h.Tipo IN ('F','N','D')
               AND h.Estado <> 'A'
               AND h.CodAux = ?
               AND EXISTS (
                 SELECT 1
                 FROM [PRODIN].[softland].[cwtauxven] av
                 WHERE av.CodAux = h.CodAux
                   AND av.VenCod IN ($in)
               )
               AND h.Fecha >= ?
               AND h.Fecha <= ?
             ORDER BY h.Fecha DESC, m.CodProd"
        );
        $stmt->execute(array_merge([$codAux], $codigos, [$desde, $hasta]));
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        return ['ok' => true, 'historial' => array_map(static function (array $row): array {
            $cod = trim((string)($row['CodAux'] ?? ''));
            $nom = trim((string)($row['NomAux'] ?? ''));
            $row['CodAux'] = $cod;
            $row['NomAux'] = $nom !== '' ? $nom : $cod;
            $row['FONAux1'] = trim((string)($row['FONAux1'] ?? ''));
            $row['FonAux2'] = trim((string)($row['FonAux2'] ?? ''));
            $row['Email'] = trim((string)($row['Email'] ?? ''));
            $row['Direccion'] = trim((string)($row['Direccion'] ?? ''));
            $row['Ciudad'] = trim((string)($row['Ciudad'] ?? ''));
            $row['CodVendedor'] = trim((string)($row['CodVendedor'] ?? ''));
            $row['Fecha'] = trim((string)($row['Fecha'] ?? ''));
            $row['CodProd'] = trim((string)($row['CodProd'] ?? ''));
            $row['DetProd'] = trim((string)($row['DetProd'] ?? ''));
            return $row;
        }, $rows)];
    }

    private function folio(array $payload, string $folio, array $query): array
    {
        $periodo = $this->monthYear($query);

        if ($this->bridgeEnabled()) {
            $bridge = $this->bridgeGet('/ventas/folio', [
                'folio' => $folio,
                'anio' => $periodo['anio'],
            ]);
            return ['ok' => true, ...((array)($bridge['data'] ?? []))];
        }

        $stmt = $this->asSoftlandPool()->prepare(
            "SELECT SubTotal, COALESCE(TotDesc, 0) AS descuento
             FROM [PRODIN].[softland].[iw_gsaen]
             WHERE Folio = ?
               AND YEAR(Fecha) = ?
               AND Tipo IN ('F','N','D')
               AND Estado <> 'A'"
        );
        $stmt->execute([$folio, $periodo['anio']]);
        $data = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$data) {
            throw new RuntimeException('Folio no encontrado', 404);
        }
        return ['ok' => true, ...$data];
    }

    private function detalle(array $payload, string $folio, array $query): array
    {
        $data = $this->analytics->detalleFolio($payload, (int)$folio);
        $detalle = $data['detalle'] ?? [];
        $primera = $detalle[0] ?? [];
        $tipo = strtoupper(trim((string)($primera['tipo_folio'] ?? $primera['Tipo'] ?? $primera['tipo'] ?? '')));
        return [
            'ok' => true,
            'detalle' => $detalle,
            'tipo_folio' => in_array($tipo, ['F', 'N', 'D'], true) ? $tipo : '',
            'Tipo' => in_array($tipo, ['F', 'N', 'D'], true) ? $tipo : '',
            'tipo' => in_array($tipo, ['F', 'N', 'D'], true) ? $tipo : '',
        ];
    }

    private function descuentos(array $payload, array $query): array
    {
        $periodo = $this->monthYear($query);
        $codigos = $this->vendorCodes($payload);
        if (!$codigos) {
            return ['ok' => true, 'data' => []];
        }
        $data = $this->analytics->vendedores($payload, $query);
        return ['ok' => true, 'data' => $data['vendedores'] ?? []];
    }
}
