<?php
declare(strict_types=1);

/** Consultas de solo lectura de Control de Muestras. Autorizacion en GerenciaService. */
final class ControlMuestrasService
{
    public function __construct(private Database $db, private string $precioSql)
    {
    }

    public function consultar(array $query, array $vendedores, ?int $usuarioId, bool $detalle): array
    {
        $desde = $this->fecha($query['desde'] ?? null);
        $hasta = $this->fecha($query['hasta'] ?? null);
        if ($desde > $hasta || $hasta === '9999-12-31') {
            throw new RuntimeException('El rango de fechas no es valido.', 400);
        }
        $fin = (new DateTimeImmutable($hasta))->modify('+1 day')->format('Y-m-d');
        $avisos = [];
        $owners = [];
        $catalogo = [];
        usort($vendedores, static fn(array $a, array $b): int => $a['usuarioId'] <=> $b['usuarioId']);
        foreach ($vendedores as $vendedor) {
            $id = (int)$vendedor['usuarioId'];
            $catalogo[$id] = ['usuarioId' => $id, 'codigoPrincipal' => $vendedor['codigoPrincipal'], 'vendedor' => $vendedor['nombre']];
            foreach ($vendedor['codigos'] as $codigo) {
                $codigo = mb_strtoupper(trim((string)$codigo));
                if ($codigo === '') continue;
                if (isset($owners[$codigo]) && $owners[$codigo] !== $id) {
                    // En TODOS un codigo solo puede contribuir una vez. Priorizar su principal.
                    if ($codigo === mb_strtoupper($vendedor['codigoPrincipal'])) $owners[$codigo] = $id;
                    $avisos[] = 'El codigo ' . $codigo . ' tiene varias relaciones; se cuenta una sola vez en TODOS, asignado a ' . $catalogo[$owners[$codigo]]['vendedor'] . '.';
                    continue;
                }
                $owners[$codigo] = $id;
            }
        }
        $resumen = $this->metricas(0, 0, 0);
        $response = ['ok' => true, 'filtros' => ['vendedorId' => $usuarioId, 'desde' => $desde, 'hasta' => $hasta],
            'resumen' => $resumen, 'evolucion' => [], 'lineas' => [], 'vendedores' => [], 'advertencias' => $avisos];
        if (!$owners) return $detalle ? $response + ['items' => []] : $response;

        $params = [];
        foreach ($owners as $codigo => $id) { $params[] = (string)$codigo; $params[] = $id; }
        $values = implode(',', array_fill(0, count($owners), '(?,?)'));
        [$fuenteSql, $fuenteParams] = $this->fuenteSql($desde, $fin);
        $params = array_merge($params, $fuenteParams);
        $producto = $detalle ? ", COALESCE(NULLIF(LTRIM(RTRIM(M.Producto)), ''), TP.DesProd) AS producto" : '';
        $productoJoin = $detalle ? 'LEFT JOIN [TEXPRO18].[softland].[iw_tprod] TP ON TP.CodProd = M.CodProd' : '';
        $cte = "WITH Relaciones AS (
            SELECT CAST(codigo AS varchar(100)) AS codigo, CAST(usuarioId AS int) AS usuarioId
            FROM (VALUES $values) V(codigo, usuarioId)
        ), MuestrasFuente AS (
            $fuenteSql
        ), MuestrasFiltradas AS (
            SELECT M.*, R.usuarioId
            FROM MuestrasFuente M
            INNER JOIN Relaciones R ON R.codigo = M.CodVendedor
        ), Productos AS (
            SELECT DISTINCT CodProd FROM MuestrasFiltradas
        ), PreciosProdin AS (
            SELECT P.CodProd, PR.CodProd AS CodigoProdin, PR.PrecioVta AS PrecioVentaProdin
            FROM Productos P {$this->precioSql}
        ), Importes AS (
            SELECT M.Tipo, M.Folio, CAST(M.Fecha AS date) AS fecha, M.usuarioId,
                M.Cantidad AS cantidad, M.ordenLinea, M.Categoria AS linea,
                M.Total AS valorMuestras,
                CONVERT(decimal(18,6), M.Cantidad) * CONVERT(decimal(18,6), COALESCE(PP.PrecioVentaProdin,0)) AS ventaPotencial
                $producto
            FROM MuestrasFiltradas M
            $productoJoin
            LEFT JOIN PreciosProdin PP ON PP.CodProd = M.CodProd
        ) ";

        if ($detalle) {
            $items = $this->rows($cte . 'SELECT Tipo AS tipo, Folio AS folio, CONVERT(varchar(10), fecha, 23) AS fecha,
                producto, cantidad, valorMuestras, ventaPotencial, ventaPotencial - valorMuestras AS diferencia, linea
                FROM Importes ORDER BY fecha DESC, Folio DESC, Tipo, ordenLinea', $params);
            $folios = [];
            foreach ($items as &$item) {
                $folios[$item['tipo'] . '|' . $item['folio']] = true;
                foreach (['cantidad', 'valorMuestras', 'ventaPotencial', 'diferencia'] as $key) $item[$key] = (float)$item[$key];
            }
            unset($item);
            $response['resumen'] = $this->metricas(count($folios), array_sum(array_column($items, 'valorMuestras')), array_sum(array_column($items, 'ventaPotencial')));
            $response['items'] = $items;
            return $response;
        }

        // SQL agrega cada componente; no se envian lineas de productos al dashboard.
        $sqlResumen = $cte . "SELECT GROUPING_ID(fecha,linea,usuarioId) AS grupo,
            CONVERT(varchar(10), fecha, 23) AS fecha, linea, usuarioId,
            COUNT(DISTINCT CONCAT(Tipo,'|',CONVERT(varchar(50),Folio))) AS folios,
            COALESCE(SUM(valorMuestras),0) AS valorMuestras, COALESCE(SUM(ventaPotencial),0) AS ventaPotencial
            FROM Importes GROUP BY GROUPING SETS ((),(fecha),(linea),(usuarioId),(usuarioId,linea))";
        // Dos SELECT independientes en un viaje al servidor, sin repetir reglas.
        $sql = $sqlResumen;
        if ($usuarioId === null) {
            $placeholders = implode(',', array_fill(0, count($owners), '?'));
            [$sinRelacionSql, $sinRelacionParams] = $this->fuenteSql($desde, $fin);
            $sql .= "; WITH MuestrasFuente AS ($sinRelacionSql)
                SELECT COUNT(DISTINCT CONCAT(Tipo,'|',Folio)) AS folios,
                    COALESCE(SUM(Total),0) AS monto
                FROM MuestrasFuente
                WHERE CodVendedor IS NULL OR CodVendedor NOT IN ($placeholders)";
            $params = array_merge($params, $sinRelacionParams, array_map('strval', array_keys($owners)));
        }
        $sets = $this->rowsets($sql, $params);
        $rows = $sets[0];
        $porVendedor = [];
        $lineasVendedor = [];
        foreach ($rows as $row) {
            $m = $this->metricas((int)$row['folios'], (float)$row['valorMuestras'], (float)$row['ventaPotencial']);
            switch ((int)$row['grupo']) {
                case 7: $response['resumen'] = $m; break;
                case 3: $response['evolucion'][] = ['fecha' => $row['fecha']] + $m; break;
                case 5: $response['lineas'][] = ['linea' => $row['linea'], 'monto' => $m['valorMuestras']]; break;
                case 6: $porVendedor[(int)$row['usuarioId']] = $catalogo[(int)$row['usuarioId']] + $m; break;
                case 4: $lineasVendedor[(int)$row['usuarioId']][] = ['linea' => $row['linea'], 'monto' => $m['valorMuestras']]; break;
            }
        }
        $response['lineas'] = $this->participaciones($response['lineas'], $response['resumen']['valorMuestras']);
        foreach ($porVendedor as $id => $vendedor) {
            if (!$vendedor['folios']) continue;
            $vendedor['lineas'] = $this->participaciones($lineasVendedor[$id] ?? [], $vendedor['valorMuestras']);
            $response['vendedores'][] = $vendedor;
        }
        usort($response['vendedores'], static fn(array $a, array $b): int => ($b['valorMuestras'] <=> $a['valorMuestras']) ?: ($a['usuarioId'] <=> $b['usuarioId']));
        usort($response['evolucion'], static fn(array $a, array $b): int => strcmp($a['fecha'], $b['fecha']));
        if ($usuarioId === null) {
            $sinRelacion = $sets[1][0];
            $response['sinRelacion'] = ['folios' => (int)$sinRelacion['folios'], 'valorMuestras' => (float)$sinRelacion['monto']];
            if ((int)$sinRelacion['folios']) $response['advertencias'][] = $sinRelacion['folios'] . ' documentos del rango tienen codigos sin relacion a vendedores principales y no se incluyen en TODOS.';
        }
        return $response;
    }

    /** Devuelve solo las fuentes necesarias para el rango; $fin es exclusivo. */
    private function fuenteSql(string $desde, string $fin): array
    {
        $corte = '2026-09-01';
        $partes = [];
        $params = [];
        $finNw = $fin > $corte ? $corte : $fin;

        if ($desde < $corte && $desde < $finNw) {
            $partes[] = "SELECT CAST('NV' AS varchar(2)) AS Tipo,
                    CONVERT(varchar(50), NV.NVNumero) AS Folio,
                    CONVERT(varchar(50), NV.NVNumero) AS NotaVenta,
                    CAST(NV.NvFem AS date) AS Fecha,
                    LTRIM(RTRIM(NV.VenCod)) AS CodVendedor,
                    LTRIM(RTRIM(D.CodProd)) AS CodProd,
                    CAST(D.DetProd AS varchar(max)) AS Producto,
                    CONVERT(decimal(38,6), D.NvCant) AS Cantidad,
                    CONVERT(decimal(38,6), D.NvPrecio) AS Precio,
                    CONVERT(decimal(38,2), D.NvTotLinea) AS Total,
                    CASE
                        WHEN LTRIM(RTRIM(D.CodProd)) LIKE 'PQ0762%' THEN 'AEROSOLES'
                        WHEN LTRIM(RTRIM(D.CodProd)) LIKE 'MU%' THEN 'QUIMICOS'
                        WHEN LTRIM(RTRIM(D.CodProd)) LIKE 'PQ%' THEN 'QUIMICOS'
                        WHEN LTRIM(RTRIM(D.CodProd)) LIKE 'AE%' THEN 'AEROSOLES'
                        WHEN LTRIM(RTRIM(D.CodProd)) LIKE 'GS%' THEN 'ACCESORIOS'
                        ELSE 'OTRO' END AS Categoria,
                    D.NvLinea AS ordenLinea
                FROM [TEXPRO18].[softland].[NW_NVENTA] NV
                INNER JOIN [TEXPRO18].[softland].[NW_DETNV] D ON D.NVNumero = NV.NVNumero
                WHERE NV.NvFem >= ? AND NV.NvFem < ?
                    AND ISNULL(NV.NvEstado, '') <> 'N'
                    AND D.CodProd IS NOT NULL AND LTRIM(RTRIM(D.CodProd)) <> ''";
            $params = array_merge($params, [$desde, $finNw]);
        }

        $inicioIw = $desde < $corte ? $corte : $desde;
        if ($inicioIw < $fin) {
            $partes[] = "SELECT CAST(G.Tipo AS varchar(2)) AS Tipo,
                    CONVERT(varchar(50), G.Folio) AS Folio,
                    CONVERT(varchar(50), G.Folio) AS NotaVenta,
                    CAST(G.Fecha AS date) AS Fecha,
                    LTRIM(RTRIM(G.CodVendedor)) AS CodVendedor,
                    LTRIM(RTRIM(M.CodProd)) AS CodProd,
                    CAST(M.DetProd AS varchar(max)) AS Producto,
                    CONVERT(decimal(38,6), M.CantFacturada) AS Cantidad,
                    COALESCE(CONVERT(decimal(38,6), M.TotLinea)
                        / NULLIF(CONVERT(decimal(38,6), M.CantFacturada), 0), 0) AS Precio,
                    CONVERT(decimal(38,2), M.TotLinea) AS Total,
                    COALESCE(NULLIF(LTRIM(RTRIM(CC.DescCC)), ''),
                        COALESCE(NULLIF(LTRIM(RTRIM(M.CodiCC)), ''), NULLIF(LTRIM(RTRIM(G.CentrodeCosto)), '')),
                        'SIN CENTRO DE COSTO') AS Categoria,
                    M.Linea AS ordenLinea
                FROM [TEXPRO18].[softland].[iw_gsaen] G
                INNER JOIN [TEXPRO18].[softland].[iw_gmovi] M ON M.Tipo = G.Tipo AND M.NroInt = G.NroInt
                LEFT JOIN [TEXPRO18].[softland].[cwtccos] CC
                    ON CC.CodiCC = COALESCE(NULLIF(LTRIM(RTRIM(M.CodiCC)), ''), NULLIF(LTRIM(RTRIM(G.CentrodeCosto)), ''))
                WHERE G.Tipo IN ('F','N','D') AND G.Fecha >= ? AND G.Fecha < ?
                    AND M.CodProd IS NOT NULL AND LTRIM(RTRIM(M.CodProd)) <> ''";
            $params = array_merge($params, [$inicioIw, $fin]);
        }

        return [implode("\nUNION ALL\n", $partes), $params];
    }

    private function fecha(mixed $value): string
    {
        if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value)) throw new RuntimeException('Debe indicar fechas validas.', 400);
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
        if (!$date || $date->format('Y-m-d') !== $value || substr($value,0,4) === '0000') throw new RuntimeException('Debe indicar fechas validas.', 400);
        return $value;
    }

    private function rowsets(string $sql, array $params): array
    {
        $stmt = $this->db->softland()->prepare($sql);
        try {
            $stmt->execute($params);
            $sets = [];
            do { $sets[] = $stmt->fetchAll(PDO::FETCH_ASSOC); } while ($stmt->nextRowset());
            return $sets;
        } finally { $stmt->closeCursor(); }
    }

    private function rows(string $sql, array $params): array
    {
        $stmt = $this->db->softland()->prepare($sql);
        try { $stmt->execute($params); return $stmt->fetchAll(PDO::FETCH_ASSOC); }
        finally { $stmt->closeCursor(); }
    }

    private function metricas(int $folios, float $muestras, float $potencial): array
    {
        $diferencia = $potencial - $muestras;
        return ['folios' => $folios, 'valorMuestras' => $muestras, 'ventaPotencial' => $potencial,
            'diferencia' => $diferencia, 'porcentajeDiferencia' => $potencial != 0.0 ? $diferencia / $potencial * 100 : 0];
    }

    private function participaciones(array $rows, float $total): array
    {
        foreach ($rows as &$row) $row['participacion'] = $total != 0.0 ? $row['monto'] / $total * 100 : 0;
        unset($row);
        usort($rows, static fn(array $a, array $b): int => $b['monto'] <=> $a['monto']);
        return $rows;
    }
}
