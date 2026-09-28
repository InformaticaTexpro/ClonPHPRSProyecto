<?php
declare(strict_types=1);

final class MuestrasService
{
    use SharedServiceHelpers;

    public function __construct(private Database $db)
    {
    }

    public function vendedorResumen(int $usuarioId, int $mes, int $anio, bool $incluirDetalle = true): array
    {
        $codigos = $this->normalizeVendorCodes($this->getVendorCodes($usuarioId));
        if (!$codigos) {
            return [
                'historico' => ['monto' => 0, 'folios' => 0],
                'mes' => ['monto' => 0, 'folios' => 0],
                'composicion' => ['historico' => []],
                'topProductosHistorico' => [],
                'valorComercialMes' => 0,
            ];
        }

        [$desde, $hasta] = $this->monthRange($anio, $mes);
        [$fuenteSql, $fuenteParams] = $this->fuenteSql($codigos, '2022-01-01', null);
        $stmt = $this->db->softland()->prepare(
            "$fuenteSql
             SELECT COALESCE(SUM(Total), 0) AS montoHistorico,
                COUNT(DISTINCT CONCAT(Tipo, '|', Folio)) AS foliosHistoricos,
                COALESCE(SUM(CASE WHEN Fecha >= ? AND Fecha < ? THEN Total ELSE 0 END), 0) AS montoMes,
                COUNT(DISTINCT CASE WHEN Fecha >= ? AND Fecha < ? THEN CONCAT(Tipo, '|', Folio) END) AS foliosMes
             FROM MuestrasFuente"
        );
        $stmt->execute(array_merge($fuenteParams, [$desde, $hasta, $desde, $hasta]));
        $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];

        $montoHistorico = (float)($row['montoHistorico'] ?? 0);
        $result = [
            'historico' => [
                'monto' => $montoHistorico,
                'folios' => (int)($row['foliosHistoricos'] ?? 0),
            ],
            'mes' => [
                'monto' => (float)($row['montoMes'] ?? 0),
                'folios' => (int)($row['foliosMes'] ?? 0),
            ],
            'valorComercialMes' => $this->valorComercialMes($codigos, $desde, $hasta),
        ];

        if ($incluirDetalle) {
            $result['composicion'] = $this->composicionVendedor($codigos, $montoHistorico);
            $result['topProductosHistorico'] = $this->topProductosVendedor($codigos, $montoHistorico);
        }

        return $result + [
            'composicion' => ['historico' => []],
            'topProductosHistorico' => [],
        ];
    }

    public function vendedorDetalle(int $usuarioId, int $mes, int $anio): array
    {
        $codigos = $this->normalizeVendorCodes($this->getVendorCodes($usuarioId));
        if (!$codigos) {
            return ['ok' => true, 'items' => [], 'monto' => 0, 'folios' => 0, 'valorComercialMes' => 0];
        }

        [$desde, $hasta] = $this->monthRange($anio, $mes);
        [$fuenteSql, $params] = $this->fuenteSql($codigos, $desde, $hasta);
        $items = $this->softlandRows(
            "$fuenteSql
             SELECT M.Tipo AS tipo, M.Folio AS folio, CONVERT(varchar(10), M.Fecha, 23) AS fecha,
                COALESCE(NULLIF(LTRIM(RTRIM(M.Producto)), ''), P.DesProd) AS producto,
                M.Cantidad AS cantidad, M.Total AS total,
                M.Categoria AS linea, M.OrdenLinea AS ordenLinea
             FROM MuestrasFuente M
             LEFT JOIN [TEXPRO18].[softland].[iw_tprod] P ON P.CodProd = M.CodProd
             ORDER BY M.Fecha DESC, M.Folio DESC, M.OrdenLinea ASC",
            $params
        );

        $centavos = 0;
        $folios = [];
        foreach ($items as &$item) {
            $centavos += (int)round((float)$item['total'] * 100);
            $item['total'] = (float)$item['total'];
            $item['cantidad'] = (float)$item['cantidad'];
            $folios[$item['tipo'] . '|' . $item['folio']] = true;
        }
        unset($item);

        return [
            'ok' => true,
            'items' => $items,
            'monto' => $centavos / 100,
            'folios' => count($folios),
            'valorComercialMes' => $this->valorComercialMes($codigos, $desde, $hasta),
        ];
    }

    public function precioProdinSql(string $codProdSql = 'M.CodProd'): string
    {
        return "OUTER APPLY (
                SELECT TOP 1 PP.CodProd, PP.PrecioVta
                FROM [PRODIN].[softland].[iw_tprod] PP
                WHERE (
                    LTRIM(RTRIM($codProdSql)) LIKE 'MU%'
                    AND LTRIM(RTRIM(PP.CodProd)) LIKE 'PQ' + SUBSTRING(LTRIM(RTRIM($codProdSql)), 3, 4) + '%'
                    AND TRY_CONVERT(INT, SUBSTRING(LTRIM(RTRIM(PP.CodProd)), 7, LEN(LTRIM(RTRIM(PP.CodProd))))) >= 10
                ) OR (
                    LTRIM(RTRIM($codProdSql)) NOT LIKE 'MU%'
                    AND LTRIM(RTRIM(PP.CodProd)) = LTRIM(RTRIM($codProdSql))
                )
                ORDER BY CASE
                    WHEN LTRIM(RTRIM($codProdSql)) LIKE 'MU%'
                        AND TRY_CONVERT(INT, SUBSTRING(LTRIM(RTRIM(PP.CodProd)), 7, LEN(LTRIM(RTRIM(PP.CodProd))))) = 10 THEN 0
                    WHEN LTRIM(RTRIM($codProdSql)) LIKE 'MU%' THEN 1
                    ELSE 0 END,
                    CASE WHEN LTRIM(RTRIM($codProdSql)) LIKE 'MU%'
                        THEN TRY_CONVERT(INT, SUBSTRING(LTRIM(RTRIM(PP.CodProd)), 7, LEN(LTRIM(RTRIM(PP.CodProd))))) ELSE 0 END,
                    PP.CodProd
             ) PR";
    }

    private function valorComercialMes(array $codigos, string $desde, string $hasta): float
    {
        [$fuenteSql, $params] = $this->fuenteSql($codigos, $desde, $hasta);
        $precioProdin = $this->precioProdinSql('P.CodProd');
        $row = $this->softlandOne(
            "$fuenteSql,
             Productos AS (SELECT DISTINCT CodProd FROM MuestrasFuente),
             PreciosProdin AS (
                SELECT P.CodProd, PR.CodProd AS CodigoProdin, PR.PrecioVta AS PrecioVentaProdin
                FROM Productos P $precioProdin
             )
             SELECT COALESCE(SUM(CONVERT(decimal(18, 6), PP.PrecioVentaProdin)
                * CONVERT(decimal(18, 6), M.Cantidad)), 0) AS valorComercialMes
             FROM MuestrasFuente M
             LEFT JOIN PreciosProdin PP ON PP.CodProd = M.CodProd",
            $params
        );
        return (float)($row['valorComercialMes'] ?? 0);
    }

    private function fuenteSql(array $codigos, string $desde, ?string $hasta): array
    {
        $corte = '2026-09-01';
        $placeholders = implode(',', array_fill(0, count($codigos), '?'));
        $partes = [];
        $params = [];

        $finNw = $hasta === null || $hasta > $corte ? $corte : $hasta;
        if ($desde < $corte && $desde < $finNw) {
            $partes[] = "SELECT CAST('NV' AS varchar(2)) AS Tipo,
                    CONVERT(varchar(50), NV.NVNumero) AS Folio,
                    CONVERT(varchar(50), NV.NVNumero) AS NotaVenta,
                    CAST(NV.NvFem AS date) AS Fecha,
                    LTRIM(RTRIM(NV.VenCod)) AS CodVendedor,
                    LTRIM(RTRIM(D.CodProd)) AS CodProd,
                    CAST(D.DetProd AS varchar(max)) AS Producto,
                    CONVERT(decimal(38, 6), D.NvCant) AS Cantidad,
                    CONVERT(decimal(38, 6), D.NvPrecio) AS Precio,
                    CONVERT(decimal(38, 2), D.NvTotLinea) AS Total,
                    CASE
                        WHEN LTRIM(RTRIM(D.CodProd)) LIKE 'PQ0762%' THEN 'AEROSOLES'
                        WHEN LTRIM(RTRIM(D.CodProd)) LIKE 'MU%' THEN 'QUIMICOS'
                        WHEN LTRIM(RTRIM(D.CodProd)) LIKE 'PQ%' THEN 'QUIMICOS'
                        WHEN LTRIM(RTRIM(D.CodProd)) LIKE 'AE%' THEN 'AEROSOLES'
                        WHEN LTRIM(RTRIM(D.CodProd)) LIKE 'GS%' THEN 'ACCESORIOS'
                        ELSE 'OTRO' END AS Categoria,
                    D.NvLinea AS OrdenLinea
                FROM [TEXPRO18].[softland].[NW_NVENTA] NV
                INNER JOIN [TEXPRO18].[softland].[NW_DETNV] D ON D.NVNumero = NV.NVNumero
                WHERE NV.NvFem >= ? AND NV.NvFem < ?
                    AND ISNULL(NV.NvEstado, '') <> 'N'
                    AND D.CodProd IS NOT NULL AND LTRIM(RTRIM(D.CodProd)) <> ''
                    AND LTRIM(RTRIM(NV.VenCod)) IN ($placeholders)";
            $params = array_merge($params, [$desde, $finNw], $codigos);
        }

        $inicioIw = $desde < $corte ? $corte : $desde;
        if ($hasta === null || $inicioIw < $hasta) {
            $finSql = $hasta === null ? '' : ' AND G.Fecha < ?';
            $partes[] = "SELECT CAST(G.Tipo AS varchar(2)) AS Tipo,
                    CONVERT(varchar(50), G.Folio) AS Folio,
                    CONVERT(varchar(50), G.Folio) AS NotaVenta,
                    CAST(G.Fecha AS date) AS Fecha,
                    LTRIM(RTRIM(G.CodVendedor)) AS CodVendedor,
                    LTRIM(RTRIM(M.CodProd)) AS CodProd,
                    CAST(M.DetProd AS varchar(max)) AS Producto,
                    CONVERT(decimal(38, 6), M.CantFacturada) AS Cantidad,
                    CASE WHEN M.CantFacturada <> 0 THEN CONVERT(decimal(38, 6), M.TotLinea) / M.CantFacturada ELSE 0 END AS Precio,
                    CONVERT(decimal(38, 2), M.TotLinea) AS Total,
                    COALESCE(NULLIF(LTRIM(RTRIM(CC.DescCC)), ''),
                        COALESCE(NULLIF(LTRIM(RTRIM(M.CodiCC)), ''), NULLIF(LTRIM(RTRIM(G.CentrodeCosto)), '')),
                        'SIN CENTRO DE COSTO') AS Categoria,
                    M.Linea AS OrdenLinea
                FROM [TEXPRO18].[softland].[iw_gsaen] G
                INNER JOIN [TEXPRO18].[softland].[iw_gmovi] M ON M.Tipo = G.Tipo AND M.NroInt = G.NroInt
                LEFT JOIN [TEXPRO18].[softland].[cwtccos] CC
                    ON CC.CodiCC = COALESCE(NULLIF(LTRIM(RTRIM(M.CodiCC)), ''), NULLIF(LTRIM(RTRIM(G.CentrodeCosto)), ''))
                WHERE G.Tipo IN ('F','N','D') AND G.Fecha >= ?$finSql
                    AND M.CodProd IS NOT NULL AND LTRIM(RTRIM(M.CodProd)) <> ''
                    AND LTRIM(RTRIM(G.CodVendedor)) IN ($placeholders)";
            $params[] = $inicioIw;
            if ($hasta !== null) $params[] = $hasta;
            $params = array_merge($params, $codigos);
        }

        return ['WITH MuestrasFuente AS (' . implode("\nUNION ALL\n", $partes) . ')', $params];
    }

    private function composicionVendedor(array $codigos, float $totalHistorico): array
    {
        [$fuenteSql, $params] = $this->fuenteSql($codigos, '2022-01-01', null);
        $rows = $this->softlandRows(
            "$fuenteSql
             SELECT Categoria AS clasificacion, SUM(Total) AS montoHistorico
             FROM MuestrasFuente GROUP BY Categoria",
            $params
        );
        $historico = [];
        foreach ($rows as $row) {
            $monto = (float)$row['montoHistorico'];
            $historico[] = [
                'clasificacion' => $row['clasificacion'],
                'monto' => $monto,
                'participacion' => $totalHistorico != 0.0 ? $monto / $totalHistorico * 100 : 0,
            ];
        }
        if (abs(array_sum(array_column($historico, 'monto')) - $totalHistorico) > 0.01) {
            throw new RuntimeException('La composicion historica de Muestras no coincide con el resumen. Revisar JOIN de centros de costo.', 500);
        }
        usort($historico, static fn(array $a, array $b): int => ($b['monto'] <=> $a['monto']) ?: strcmp($a['clasificacion'], $b['clasificacion']));
        return ['historico' => $historico];
    }

    private function topProductosVendedor(array $codigos, float $totalHistorico): array
    {
        [$fuenteSql, $params] = $this->fuenteSql($codigos, '2022-01-01', null);
        $rows = $this->softlandRows(
            "$fuenteSql
             SELECT TOP 10 M.CodProd AS codigoProducto,
                COALESCE(NULLIF(LTRIM(RTRIM(MAX(M.Producto))), ''), MAX(P.DesProd)) AS producto,
                SUM(M.Total) AS monto
             FROM MuestrasFuente M
             LEFT JOIN [TEXPRO18].[softland].[iw_tprod] P ON P.CodProd = M.CodProd
             GROUP BY M.CodProd
             ORDER BY monto DESC, codigoProducto ASC",
            $params
        );
        foreach ($rows as &$row) {
            $row['monto'] = (float)$row['monto'];
            $row['participacion'] = $totalHistorico != 0.0 ? $row['monto'] / $totalHistorico * 100 : 0;
        }
        unset($row);
        return $rows;
    }

    private function monthRange(int $anio, ?int $mes = null): array
    {
        if ($mes === null) {
            return [sprintf('%04d-01-01', $anio), sprintf('%04d-01-01', $anio + 1)];
        }
        $desde = sprintf('%04d-%02d-01', $anio, $mes);
        $hasta = (new DateTimeImmutable($desde))->modify('first day of next month')->format('Y-m-d');
        return [$desde, $hasta];
    }

    private function softlandRows(string $sql, array $params = []): array
    {
        $stmt = $this->db->softland()->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    private function softlandOne(string $sql, array $params = []): array
    {
        $rows = $this->softlandRows($sql, $params);
        return $rows[0] ?? [];
    }
}
