<?php
declare(strict_types=1);

final class AnalyticsService
{
    use SharedServiceHelpers;

    public function __construct(private Database $db)
    {
    }

    private function getVendorName(string $codVendedor): string
    {
        $cod = trim($codVendedor);
        if ($cod === '') {
            return '';
        }

        try {
            $row = $this->db->fetchOne(
                'SELECT u.nombre
                 FROM usuario_vendedor uv
                 INNER JOIN usuario u ON u.id = uv.usuario_id
                 WHERE TRIM(uv.cod_vendedor) = ?
                 LIMIT 1',
                [$cod]
            );
            $nombre = trim((string)($row['nombre'] ?? ''));
            return $nombre !== '' ? $nombre : $cod;
        } catch (Throwable) {
            return $cod;
        }
    }

    private function inClause(array $values, array &$params): string
    {
        $placeholders = [];
        foreach ($values as $value) {
            $placeholders[] = '?';
            $params[] = $value;
        }
        return implode(',', $placeholders);
    }

    private function asFloat(mixed $value): float
    {
        return is_numeric($value) ? (float)$value : 0.0;
    }

    private function lineListTotal(float $cantidad, float $precioLista): float
    {
        return $cantidad * $precioLista;
    }

    private function lineSalePrice(float $netoCobrado, float $cantidad): float
    {
        return $cantidad !== 0.0 ? $netoCobrado / $cantidad : 0.0;
    }

    private function discountPercent(float $lista, float $cobrado): float
    {
        $base = abs($lista);
        if ($base <= 0.0) {
            return 0.0;
        }

        return round((1 - (abs($cobrado) / $base)) * 100, 2);
    }

    private function fetchMetaMes(int $userId, int $anio, int $mes): array
    {
        $fechaMes = $this->monthStart($anio, $mes);
        $row = $this->db->fetchOne(
            "SELECT vm.id, vm.usuario_id, vm.fecha, vm.tipo_periodo, vm.meta, vm.activo, vm.observacion,
                    u.nombre AS usuario_nombre, u.email AS usuario_email, u.area AS usuario_area, u.codigo AS usuario_codigo
             FROM vendedor_meta vm
             LEFT JOIN usuario u ON u.id = vm.usuario_id
             WHERE vm.usuario_id = ?
               AND COALESCE(vm.activo, 1) = 1
               AND (
                 (vm.tipo_periodo = 'mensual' AND vm.fecha = ?)
                 OR (vm.tipo_periodo = 'anual' AND YEAR(vm.fecha) = ?)
               )
             ORDER BY CASE WHEN vm.tipo_periodo = 'mensual' THEN 0 ELSE 1 END, vm.fecha ASC, vm.id ASC
             LIMIT 1",
            [$userId, $fechaMes, $anio]
        );

        return [
            'meta_original' => (float)($row['meta'] ?? 0),
            'meta_mes' => (float)($row['meta'] ?? 0),
            'tipo_periodo' => $row['tipo_periodo'] ?? null,
            'fecha' => isset($row['fecha']) ? substr((string)$row['fecha'], 0, 10) : null,
            'prorrateada' => false,
        ];
    }

    public function resumen(array $payload, array $query): array
    {
        $userId = $this->currentUserIdFromPayload($payload);
        $vendCodes = $this->getVendorCodes($userId);
        $params = $this->monthYear($query);
        $mes = $params['mes'];
        $anio = $params['anio'];
        $meta = $this->fetchMetaMes($userId, $anio, $mes);
        if ($unavailable = $this->softlandUnavailable('el resumen del dashboard')) {
            return $unavailable;
        }

        if (!$vendCodes) {
            return [
                'ok' => true,
                'totalVentas' => 0,
                'meta' => (float)$meta['meta_mes'],
                'progreso' => 0,
                'pctDescuentoGlobal' => 0,
            ];
        }

        $pool = $this->softland();
        $sql = sprintf(
            "SELECT SUM(m.TotLinea) AS totalVentasCobrado,
                    SUM(m.CantFacturada * ISNULL(t.PrecioVta, 0)) AS totalVentasLista
             FROM [PRODIN].[softland].[iw_gsaen] enc
             INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = enc.NroInt AND m.Tipo = enc.Tipo
             INNER JOIN [PRODIN].[softland].[iw_tprod] t ON t.CodProd = m.CodProd
             WHERE enc.Tipo IN ('F','N','D')
               AND enc.Estado <> 'A'
               AND enc.CodVendedor IN (%s)
               AND MONTH(enc.Fecha) = ? AND YEAR(enc.Fecha) = ?",
            implode(',', array_fill(0, count($vendCodes), '?'))
        );
        $stmt = $pool->prepare($sql);
        $stmt->execute(array_merge($vendCodes, [$mes, $anio]));
        $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
        $ventas = (float)($row['totalVentasCobrado'] ?? 0);
        $lista = (float)($row['totalVentasLista'] ?? 0);
        $descuento = $lista > 0 ? max(0, $lista - $ventas) : 0;

        $metaMes = (float)$meta['meta_mes'];
        $progreso = $metaMes > 0 ? (int)round(($ventas / $metaMes) * 100) : 0;

        return [
            'ok' => true,
            'totalVentas' => (int)round($ventas),
            'meta' => (int)round($metaMes),
            'progreso' => $progreso,
            'pctDescuentoGlobal' => $lista > 0 ? round((1 - ($ventas / $lista)) * 100, 2) : 0,
        ];
    }

    public function evolucion(array $payload, array $query): array
    {
        $userId = $this->currentUserIdFromPayload($payload);
        $vendCodes = $this->getVendorCodes($userId);
        $anio = Security::validate_mes_anio($query['mes'] ?? 1, $query['anio'] ?? null)['anio'];
        $meta = $this->fetchMetaMes($userId, $anio, 1);
        if ($unavailable = $this->softlandUnavailable('la evolución mensual')) {
            return $unavailable;
        }

        $evolucion = array_map(static fn(int $mes): array => [
            'mes' => $mes,
            'ventas' => 0,
            'meta' => (float)$meta['meta_mes'],
            'meta_mes' => (float)$meta['meta_mes'],
            'tipo_meta' => $meta['tipo_periodo'],
            'prorrateada' => $meta['prorrateada'],
        ], range(1, 12));

        if (!$vendCodes) {
            return ['ok' => true, 'evolucion' => $evolucion];
        }

        $pool = $this->softland();
        $sql = sprintf(
            "SELECT MONTH(enc.Fecha) AS mes, SUM(m.TotLinea) AS ventas
             FROM [PRODIN].[softland].[iw_gsaen] enc
             INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = enc.NroInt AND m.Tipo = enc.Tipo
             WHERE enc.CodVendedor IN (%s)
               AND YEAR(enc.Fecha) = ?
               AND enc.Tipo IN ('F','N','D')
               AND enc.Estado <> 'A'
             GROUP BY MONTH(enc.Fecha)
             ORDER BY mes",
            implode(',', array_fill(0, count($vendCodes), '?'))
        );
        $stmt = $pool->prepare($sql);
        $stmt->execute(array_merge($vendCodes, [$anio]));
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $mes = (int)($row['mes'] ?? 0);
            if ($mes >= 1 && $mes <= 12) {
                $evolucion[$mes - 1]['ventas'] = (int)round((float)($row['ventas'] ?? 0));
            }
        }

        return ['ok' => true, 'evolucion' => $evolucion];
    }

    public function vendedores(array $payload, array $query): array
    {
        $userId = $this->currentUserIdFromPayload($payload);
        $vendCodes = $this->getVendorCodes($userId);
        $params = $this->monthYear($query);
        $mes = $params['mes'];
        $anio = $params['anio'];
        if ($unavailable = $this->softlandUnavailable('los vendedores')) {
            return $unavailable;
        }
        if (!$vendCodes) {
            return ['ok' => true, 'vendedores' => []];
        }

        $pool = $this->softland();
        $sql = sprintf(
            "SELECT
                enc.CodVendedor AS codVendedor,
                MIN(enc.NomAux) AS nombreVendedor,
                COUNT(DISTINCT enc.Folio) AS totalFolios,
                SUM(m.TotLinea) AS totalVentasCobrado,
                SUM(m.CantFacturada * ISNULL(t.PrecioVta, 0)) AS ventaRealLista
             FROM [PRODIN].[softland].[iw_gsaen] enc
             INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = enc.NroInt AND m.Tipo = enc.Tipo
             INNER JOIN [PRODIN].[softland].[iw_tprod] t ON t.CodProd = m.CodProd
             WHERE enc.CodVendedor IN (%s)
               AND enc.Tipo IN ('F','N','D')
               AND enc.Estado <> 'A'
               AND MONTH(enc.Fecha) = ? AND YEAR(enc.Fecha) = ?
             GROUP BY enc.CodVendedor
             ORDER BY totalVentasCobrado DESC",
            implode(',', array_fill(0, count($vendCodes), '?'))
        );
        $stmt = $pool->prepare($sql);
        $stmt->execute(array_merge($vendCodes, [$mes, $anio]));
        $rows = [];
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $ventas = (float)($row['totalVentasCobrado'] ?? 0);
            $lista = (float)($row['ventaRealLista'] ?? 0);
            $rows[] = [
                'codVendedor' => trim((string)$row['codVendedor']),
                'nombreVendedor' => $this->getVendorName((string)$row['codVendedor']),
                'totalFolios' => (int)($row['totalFolios'] ?? 0),
                'totalVentasCobrado' => (int)round($ventas),
                'ventaRealLista' => (int)round($lista),
                'pctDescuento' => $lista > 0 ? round((1 - $ventas / $lista) * 100, 2) : 0,
            ];
        }

        return ['ok' => true, 'vendedores' => $rows];
    }

    public function ventasMes(array $payload, array $query): array
    {
        $userId = $this->currentUserIdFromPayload($payload);
        $vendCodes = $this->getVendorCodes($userId);
        $params = $this->monthYear($query);
        $mes = $params['mes'];
        $anio = $params['anio'];
        if ($unavailable = $this->softlandUnavailable('las ventas del mes')) {
            return $unavailable;
        }
        if (!$vendCodes) {
            return ['ok' => true, 'ventas' => []];
        }

        $pool = $this->softland();
        $sql = sprintf(
            "SELECT
                enc.Folio,
                CONVERT(varchar(10), enc.Fecha, 120) AS fecha_formato,
                RTRIM(enc.CodAux) AS CodAux,
                RTRIM(
                    COALESCE(
                        NULLIF(LTRIM(RTRIM(CONVERT(varchar(max), enc.NomAux))), ''),
                        NULLIF(LTRIM(RTRIM(CONVERT(varchar(max), c.NomAux))), ''),
                        enc.CodAux
                    )
                ) AS cliente,
                enc.CodVendedor,
                enc.Tipo,
                SUM(m.TotLinea) AS monto,
                SUM(m.CantFacturada * ISNULL(t.PrecioVta, 0)) AS venta_lista_folio
             FROM [PRODIN].[softland].[iw_gsaen] enc
             INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = enc.NroInt AND m.Tipo = enc.Tipo
             LEFT JOIN [PRODIN].[softland].[iw_tprod] t ON t.CodProd = m.CodProd
             LEFT JOIN [PRODIN].[softland].[cwtauxi] c ON c.CodAux = enc.CodAux
             WHERE enc.CodVendedor IN (%s)
               AND enc.Tipo IN ('F','N','D')
               AND enc.Estado <> 'A'
               AND MONTH(enc.Fecha) = ? AND YEAR(enc.Fecha) = ?
             GROUP BY enc.Folio, enc.Fecha, enc.CodAux, CONVERT(varchar(max), enc.NomAux), CONVERT(varchar(max), c.NomAux), enc.CodVendedor, enc.Tipo
             ORDER BY enc.Fecha DESC, enc.Folio DESC",
            implode(',', array_fill(0, count($vendCodes), '?'))
        );
        $stmt = $pool->prepare($sql);
        $stmt->execute(array_merge($vendCodes, [$mes, $anio]));
        $ventas = [];
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $monto = $this->asFloat($row['monto'] ?? 0);
            $lista = $this->asFloat($row['venta_lista_folio'] ?? 0);
            $ventas[] = [
                'Folio' => (int)($row['Folio'] ?? 0),
                'fecha_formato' => (string)($row['fecha_formato'] ?? ''),
                'cliente' => trim((string)($row['cliente'] ?? '')),
                'CodAux' => trim((string)($row['CodAux'] ?? '')),
                'CodVendedor' => trim((string)($row['CodVendedor'] ?? '')),
                'Tipo' => strtoupper(trim((string)($row['Tipo'] ?? ''))),
                'monto' => (int)round($monto),
                'venta_real_folio' => (int)round($lista),
                'venta_lista_folio' => (int)round($lista),
                'TotLineaReal' => (int)round($lista),
                'pct_descuento' => $this->discountPercent($lista, $monto),
                'es_compartido' => false,
            ];
        }

        return ['ok' => true, 'ventas' => $ventas];
    }

    public function vendedoresTodos(array $payload): array
    {
        $this->currentUserIdFromPayload($payload);
        if ($unavailable = $this->softlandUnavailable('el catálogo de vendedores')) {
            return $unavailable;
        }
        $rows = $this->db->fetchAll(
            "SELECT u.id AS usuario_id, u.nombre, uv.cod_vendedor
             FROM usuario u
             INNER JOIN usuario_vendedor uv ON uv.usuario_id = u.id
             WHERE uv.tipo <> 'C' AND u.is_active = 1
             ORDER BY u.nombre ASC, LENGTH(TRIM(uv.cod_vendedor)) ASC, TRIM(uv.cod_vendedor) ASC"
        );

        $vendedores = [];
        $vistos = [];
        foreach ($rows as $row) {
            $usuarioId = (int)($row['usuario_id'] ?? 0);
            $cod = trim((string)($row['cod_vendedor'] ?? ''));
            if ($usuarioId <= 0 || $cod === '') {
                continue;
            }
            if (!isset($vistos[$usuarioId])) {
                $vistos[$usuarioId] = ['cod' => $cod, 'nombre' => trim((string)($row['nombre'] ?? ''))];
                $vendedores[] = $vistos[$usuarioId];
            }
        }

        usort($vendedores, static fn(array $a, array $b): int => strcasecmp($a['nombre'], $b['nombre']));
        return ['ok' => true, 'vendedores' => $vendedores];
    }

    public function detalleFolio(array $payload, int $folio): array
    {
        $this->currentUserIdFromPayload($payload);
        if ($unavailable = $this->softlandUnavailable('el detalle del folio')) {
            return $unavailable;
        }
        $pool = $this->softland();
        $stmt = $pool->prepare(
            "SELECT
                h.Folio,
                h.Fecha,
                h.Tipo,
                h.CodVendedor,
                h.CodAux,
                h.CanCod,
                COALESCE(
                    NULLIF(LTRIM(RTRIM(CONVERT(varchar(max), h.NomAux))), ''),
                    NULLIF(LTRIM(RTRIM(CONVERT(varchar(max), c.NomAux))), ''),
                    RTRIM(h.CodAux)
                ) AS Cliente,
                RTRIM(h.CodAux) AS cod_aux,
                RTRIM(h.CodAux) AS CodAux,
                RTRIM(h.CanCod) AS cancod,
                RTRIM(h.CanCod) AS CanCod,
                m.CodProd,
                LTRIM(RTRIM(CONVERT(varchar(max), m.DetProd))) AS DesProd,
                m.CantFacturada,
                m.TotLinea,
                m.CantFacturada * ISNULL(t.PrecioVta, 0) AS neto_real,
                m.TotLinea AS neto_total,
                ISNULL(t.PrecioVta, 0) AS precio_real,
                CASE
                    WHEN ISNULL(m.CantFacturada, 0) <> 0
                    THEN m.TotLinea / NULLIF(m.CantFacturada, 0)
                    ELSE 0
                END AS precio_vta,
                ISNULL(t.PrecioVta, 0) AS PrecioVta
             FROM [PRODIN].[softland].[iw_gsaen] h
             INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = h.NroInt AND m.Tipo = h.Tipo
             LEFT JOIN [PRODIN].[softland].[cwtauxi] c ON c.CodAux = h.CodAux
             LEFT JOIN [PRODIN].[softland].[iw_tprod] t ON t.CodProd = m.CodProd
             WHERE h.Folio = ?
               AND h.Tipo IN ('F','N','D')
               AND h.Estado <> 'A'
             ORDER BY m.CodProd"
        );
        $stmt->execute([$folio]);
        $rows = [];
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $cantidad = $this->asFloat($row['CantFacturada'] ?? 0);
            $totalCobrado = $this->asFloat($row['neto_total'] ?? 0);
            $precioLista = $this->asFloat($row['precio_real'] ?? 0);
            $totalReal = $this->lineListTotal($cantidad, $precioLista);
            $precioVenta = $this->lineSalePrice($totalCobrado, $cantidad);

            $row['CantFacturada'] = $cantidad;
            $row['neto_real'] = $totalReal;
            $row['neto_total'] = $totalCobrado;
            $row['precio_real'] = $precioLista;
            $row['precio_vta'] = $precioVenta;
            $row['PrecioVta'] = $precioLista;
            $row['Tipo'] = strtoupper(trim((string)($row['Tipo'] ?? '')));
            $row['tipo'] = $row['Tipo'];
            $row['tipo_folio'] = $row['Tipo'];
            $row['dcto'] = $this->discountPercent($totalReal, $totalCobrado);
            $rows[] = $row;
        }
        return ['ok' => true, 'folio' => $folio, 'detalle' => $rows];
    }

    public function cartera(array $payload, array $query): array
    {
        $userId = $this->currentUserIdFromPayload($payload);
        $vendCodes = $this->getVendorCodes($userId);
        $params = $this->monthYear($query);
        $mes = $params['mes'];
        $anio = $params['anio'];
        if ($unavailable = $this->softlandUnavailable('la cartera de clientes')) {
            return $unavailable;
        }
        if (!$vendCodes) {
            return [
                'ok' => true,
                'TotalClientes' => 0,
                'ClientesActivos' => 0,
                'ClientesInactivos' => 0,
                'ClientesNuevos' => 0,
                'ClientesRecuperados' => 0,
                'total' => [], 'activos' => [], 'inactivos' => [], 'nuevos' => [], 'recuperados' => [], 'activosMesActual' => [],
            ];
        }

        $desde = new DateTimeImmutable($this->monthStart($anio, $mes));
        $hasta = new DateTimeImmutable($this->monthEnd($anio, $mes));
        $ventanaActiva = $hasta->modify('-90 days');
        $ventanaRecupero = $hasta->modify('-180 days');

        $paramsClients = [];
        $inClients = $this->inClause($vendCodes, $paramsClients);
        $pool = $this->softland();

        $clientsStmt = $pool->prepare(
            "SELECT DISTINCT CodAux
             FROM [PRODIN].[softland].[cwtauxven]
             WHERE VenCod IN ($inClients)"
        );
        $clientsStmt->execute($paramsClients);
        $clients = $clientsStmt->fetchAll(PDO::FETCH_ASSOC);
        $clientCodes = array_values(array_filter(array_map(static function (array $row): string {
            return trim((string)($row['CodAux'] ?? ''));
        }, $clients)));
        if (!$clientCodes) {
            return [
                'ok' => true,
                'TotalClientes' => 0,
                'ClientesActivos' => 0,
                'ClientesInactivos' => 0,
                'ClientesNuevos' => 0,
                'ClientesRecuperados' => 0,
                'total' => [], 'activos' => [], 'inactivos' => [], 'nuevos' => [], 'recuperados' => [], 'activosMesActual' => [],
            ];
        }

        $paramsPurchases = [];
        $inPurchases = $this->inClause($clientCodes, $paramsPurchases);
        $stmt = $pool->prepare(
            "SELECT h.CodAux, h.Fecha, RTRIM(a.NomAux) AS NomAux, RTRIM(a.FonAux1) AS FONAux1, RTRIM(a.FonAux2) AS FonAux2, RTRIM(a.EMail) AS EMail
             FROM [PRODIN].[softland].[iw_gsaen] h
             INNER JOIN [PRODIN].[softland].[cwtauxi] a ON a.CodAux = h.CodAux
             WHERE h.CodAux IN ($inPurchases)
               AND h.Tipo IN ('F','N','D')
               AND h.Estado <> 'A'
               AND h.Fecha <= ?
             ORDER BY h.CodAux ASC, h.Fecha ASC"
        );
        $stmt->execute(array_merge($paramsPurchases, [$hasta->format('Y-m-d')]));
        $purchasesByClient = [];
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $codAux = trim((string)($row['CodAux'] ?? ''));
            if ($codAux === '') {
                continue;
            }
            $purchasesByClient[$codAux][] = $row;
        }

        $rows = [];
        foreach ($clients as $clientRow) {
            $codAux = trim((string)($clientRow['CodAux'] ?? ''));
            if ($codAux === '') {
                continue;
            }
            $history = $purchasesByClient[$codAux] ?? [];
            $datesGlobales = array_values(array_filter(array_map(static function (array $r): ?DateTimeImmutable {
                try {
                    return new DateTimeImmutable(substr((string)($r['Fecha'] ?? ''), 0, 10));
                } catch (Throwable) {
                    return null;
                }
            }, $history)));

            $fechaUltima = $datesGlobales ? $datesGlobales[count($datesGlobales) - 1] : null;
            $fechaPrimera = $datesGlobales ? $datesGlobales[0] : null;
            $fechaMinMes = null;
            foreach ($datesGlobales as $date) {
                if ($date >= $desde && $date <= $hasta) {
                    $fechaMinMes = $date;
                    break;
                }
            }

            $esActivo = $fechaUltima && $fechaUltima >= $ventanaActiva;
            $esInactivo = !$fechaUltima || $fechaUltima < $ventanaActiva;
            // Nuevo = primera compra histórica real del cliente dentro del mes filtrado.
            $esNuevo = $fechaPrimera && $fechaPrimera >= $desde && $fechaPrimera <= $hasta;
            $esRecuperado = false;
            if ($fechaMinMes) {
                $tieneSilencio = true;
                $tieneHistorial = false;
                foreach ($datesGlobales as $date) {
                    if ($date < $fechaMinMes->modify('-180 days')) {
                        $tieneHistorial = true;
                    }
                    if ($date >= $fechaMinMes->modify('-180 days') && $date < $fechaMinMes) {
                        $tieneSilencio = false;
                        break;
                    }
                }
                $esRecuperado = $tieneSilencio && $tieneHistorial;
            }
            $esActivoMesActual = $fechaUltima && $fechaUltima >= $desde && $fechaUltima <= $hasta;

            $rows[] = [
                'CodAux' => $codAux,
                'NomAux' => $history[0]['NomAux'] ?? '',
                'FONAUX1' => $history[0]['FONAux1'] ?? '',
                'FonAux2' => $history[0]['FonAux2'] ?? '',
                'EMail' => $history[0]['EMail'] ?? '',
                'FechaUltimaCompra' => $fechaUltima?->format('Y-m-d'),
                'FechaPrimeraCompra' => $fechaPrimera?->format('Y-m-d'),
                'FechaMinMesActual' => $fechaMinMes?->format('Y-m-d'),
                'EsActivo' => $esActivo ? 1 : 0,
                'EsInactivo' => $esInactivo ? 1 : 0,
                'EsNuevo' => $esNuevo ? 1 : 0,
                'EsRecuperado' => $esRecuperado ? 1 : 0,
                'EsActivoMesActual' => $esActivoMesActual ? 1 : 0,
            ];
        }

        $total = $rows;
        $activos = array_values(array_filter($rows, static fn(array $r): bool => (int)($r['EsActivo'] ?? 0) === 1));
        $inactivos = array_values(array_filter($rows, static fn(array $r): bool => (int)($r['EsInactivo'] ?? 0) === 1));
        $nuevos = array_values(array_filter($rows, static fn(array $r): bool => (int)($r['EsNuevo'] ?? 0) === 1));
        $recuperados = array_values(array_filter($rows, static fn(array $r): bool => (int)($r['EsRecuperado'] ?? 0) === 1));
        $activosMesActual = array_values(array_filter($rows, static fn(array $r): bool => (int)($r['EsActivoMesActual'] ?? 0) === 1));

        return [
            'ok' => true,
            'TotalClientes' => count($total),
            'ClientesActivos' => count($activos),
            'ClientesInactivos' => count($inactivos),
            'ClientesNuevos' => count($nuevos),
            'ClientesRecuperados' => count($recuperados),
            'total' => $total,
            'activos' => $activos,
            'inactivos' => $inactivos,
            'nuevos' => $nuevos,
            'recuperados' => $recuperados,
            'activosMesActual' => $activosMesActual,
        ];
    }

    public function compartirLista(array $payload, array $query): array
    {
        $codigosCoord = $this->coordinatorCodes($payload);
        if (!$codigosCoord) {
            throw new RuntimeException('No autorizado para compartir', 403);
        }

        $periodoSolicitado = $this->monthYear($query);
        $mes = $periodoSolicitado['mes'];
        $anio = $periodoSolicitado['anio'];

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
                COALESCE(NULLIF(LTRIM(RTRIM(c.NomAux)), ''), NULLIF(LTRIM(RTRIM(h.CodAux)), '')) AS cliente,
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
            GROUP BY h.Folio, h.Fecha, h.CodAux, c.NomAux, h.CodVendedor
            ORDER BY h.Fecha DESC
        ";

        $loadFolios = static function (PDO $softland, string $sql, array $params): array {
            $stmt = $softland->prepare($sql);
            $stmt->execute($params);
            return array_map(static function (array $row): array {
                return [
                    'Folio' => (int)($row['Folio'] ?? 0),
                    'fecha_formato' => trim((string)($row['fecha_formato'] ?? '')),
                    'cliente' => trim((string)($row['cliente'] ?? '')),
                    'monto' => (int)round((float)($row['monto'] ?? 0)),
                    'CodVendedor' => trim((string)($row['CodVendedor'] ?? '')),
                ];
            }, $stmt->fetchAll(PDO::FETCH_ASSOC));
        };
        $folios = $loadFolios($softland, $sql, array_merge($codigosCoord, [$mes, $anio]));

        return [
            'ok' => true,
            'periodo_solicitado' => $periodoSolicitado,
            'folios' => $folios,
        ];
    }

    public function compartidos(array $payload, array $query): array
    {
        $codes = $this->vendorCodes($payload);
        if (!$codes) {
            return [];
        }

        $periodo = $this->monthYear($query);
        $mes = $periodo['mes'];
        $anio = $periodo['anio'];
        $placeholders = implode(',', array_fill(0, count($codes), '?'));
        $rows = $this->db->fetchAll(
            "SELECT fc.id, fc.folio, fc.fecha, fc.mes, fc.anio,
                    COALESCE(
                      NULLIF(TRIM(fc.cliente), ''),
                      NULLIF(TRIM(c.NomAux), ''),
                      CAST(fc.folio AS CHAR)
                    ) AS cliente,
                    fc.monto_neto, fc.monto_asignado, fc.porcentaje,
                    fc.cod_vendedor_principal, fc.cod_vendedor_compartido, fc.nombre_vendedor_compartido,
                    fc.monto_asignado AS monto, COALESCE(u.nombre, fc.cod_vendedor_principal) AS coordinador
             FROM factura_compartida fc
             LEFT JOIN usuario_vendedor uv ON uv.cod_vendedor = fc.cod_vendedor_principal
             LEFT JOIN usuario u ON u.id = uv.usuario_id
             LEFT JOIN (
                SELECT h.Folio, YEAR(h.Fecha) AS anio, MONTH(h.Fecha) AS mes,
                       COALESCE(NULLIF(LTRIM(RTRIM(c.NomAux)), ''), NULLIF(LTRIM(RTRIM(h.CodAux)), '')) AS NomAux
                FROM [PRODIN].[softland].[iw_gsaen] h
                LEFT JOIN [PRODIN].[softland].[cwtauxi] c ON c.CodAux = h.CodAux
                WHERE h.Tipo IN ('F','N','D') AND h.Estado <> 'A'
             ) c ON c.Folio = fc.folio AND c.anio = fc.anio AND c.mes = fc.mes
             WHERE fc.cod_vendedor_compartido IN ($placeholders)
               AND fc.mes = ?
               AND fc.anio = ?
               AND fc.rol = 'compartido'
             ORDER BY fc.fecha DESC",
            array_merge($codes, [$mes, $anio])
        );

        return array_map(static function (array $row): array {
            return [
                'id' => (int)($row['id'] ?? 0),
                'folio' => (string)($row['folio'] ?? ''),
                'fecha' => (string)($row['fecha'] ?? ''),
                'cliente' => trim((string)($row['cliente'] ?? '')),
                'monto_neto' => (float)($row['monto_neto'] ?? 0),
                'monto_asignado' => (float)($row['monto_asignado'] ?? 0),
                'porcentaje' => (float)($row['porcentaje'] ?? 0),
                'cod_vendedor_principal' => trim((string)($row['cod_vendedor_principal'] ?? '')),
                'cod_vendedor_compartido' => trim((string)($row['cod_vendedor_compartido'] ?? '')),
                'nombre_vendedor_compartido' => trim((string)($row['nombre_vendedor_compartido'] ?? '')),
                'monto' => (float)($row['monto'] ?? 0),
                'coordinador' => trim((string)($row['coordinador'] ?? '')),
            ];
        }, $rows);
    }

    public function asignados(array $payload, array $query): array
    {
        $coordinatorCodes = $this->coordinatorCodes($payload);
        $vendorCodes = $this->vendorCodes($payload);

        $codes = $coordinatorCodes ?: $vendorCodes;
        if (!$codes) {
            return ['ok' => true, 'asignados' => [], 'periodo_solicitado' => null, 'periodo_utilizado' => null];
        }

        $periodoSolicitado = $this->monthYear($query);
        $params = $codes;
        $esCoordinador = (bool)$coordinatorCodes;
        $sql = "
            SELECT fc.id, fc.folio, fc.fecha,
                   COALESCE(
                     NULLIF(TRIM(fc.cliente), ''),
                     CAST(fc.folio AS CHAR)
                   ) AS cliente,
                   fc.monto_neto, fc.monto_asignado, fc.porcentaje,
                   fc.cod_vendedor_principal, fc.cod_vendedor_compartido, fc.nombre_vendedor_compartido,
                   fc.monto_asignado AS monto,
                   COALESCE(
                     u_comp.nombre,
                     fc.nombre_vendedor_compartido,
                     fc.cod_vendedor_compartido,
                     COALESCE(u_principal.nombre, fc.cod_vendedor_principal)
                   ) AS vendedor
            FROM factura_compartida fc
            LEFT JOIN usuario_vendedor uv_comp ON TRIM(uv_comp.cod_vendedor) = TRIM(fc.cod_vendedor_compartido)
            LEFT JOIN usuario u_comp ON u_comp.id = uv_comp.usuario_id
            LEFT JOIN usuario_vendedor uv_principal ON TRIM(uv_principal.cod_vendedor) = TRIM(fc.cod_vendedor_principal)
            LEFT JOIN usuario u_principal ON u_principal.id = uv_principal.usuario_id
            WHERE " . ($esCoordinador
                ? 'fc.cod_vendedor_principal'
                : 'fc.cod_vendedor_compartido') . " IN (" . implode(',', array_fill(0, count($codes), '?')) . ")
              AND fc.rol = 'compartido'
              AND fc.mes = ?
              AND fc.anio = ?
        ";
        $sql .= ' ORDER BY fc.fecha DESC';

        $params[] = $periodoSolicitado['mes'];
        $params[] = $periodoSolicitado['anio'];
        $rows = $this->db->fetchAll($sql, $params);

        return [
            'ok' => true,
            'periodo_solicitado' => $periodoSolicitado,
            'asignados' => $rows,
        ];
    }

    public function categoriasVendedor(array $payload, array $query): array
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

    public function clientesResumen(array $payload, array $query): array
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

