<?php
declare(strict_types=1);

final class AnalyticsService
{
    use SharedServiceHelpers;

    public function __construct(private Database $db)
    {
    }

    private function normalizeVendorCodes(array $codes): array
    {
        $normalized = [];

        foreach ($codes as $raw) {
            $code = trim((string)$raw);
            if ($code === '') {
                continue;
            }

            $normalized[$code] = true;

            if (preg_match('/^\d+$/', $code)) {
                $unpad = ltrim($code, '0');
                if ($unpad === '') {
                    $unpad = '0';
                }

                $normalized[$unpad] = true;
                $normalized[str_pad($unpad, 2, '0', STR_PAD_LEFT)] = true;
                $normalized[str_pad($unpad, 4, '0', STR_PAD_LEFT)] = true;
            }
        }

        return array_keys($normalized);
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

    private function softlandVentaTiposSql(string $alias = 'enc'): string
    {
        return sprintf("%s.Tipo IN ('F','N','D')", $alias);
    }

    private function fetchCategoriaCatalogo(): array
    {
        $catRows = $this->db->fetchAll('SELECT Cta, Categoria FROM categoriasproducto');
        $catMap = [];
        $categorias = [];

        foreach ($catRows as $row) {
            $cta = trim((string)($row['Cta'] ?? ''));
            $categoria = trim((string)($row['Categoria'] ?? ''));
            if ($cta === '' || $categoria === '') {
                continue;
            }

            $catMap[$cta] = $categoria;
            $categorias[$categoria] = true;
        }

        return [
            'mapa' => $catMap,
            'categorias' => array_keys($categorias),
        ];
    }

    private function fetchDirectCategoryTotals(array $vendCodes, int $mes, int $anio): array
    {
        $codes = array_values(array_unique(array_filter(array_map(
            static fn(mixed $code): string => trim((string)$code),
            $vendCodes
        ))));
        if (!$codes) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($codes), '?'));
        $inicioMes = $this->monthStart($anio, $mes);
        $finMes = (new DateTimeImmutable($inicioMes))->modify('+1 month')->format('Y-m-d');
        $pdo = $this->db->softland();
        $stmt = $pdo->prepare(
            "SELECT
                LTRIM(RTRIM(enc.CodVendedor)) AS codVendedor,
                LTRIM(RTRIM(t.CtaVentas)) AS ctaVentas,
                SUM(m.TotLinea) AS totalVentas
             FROM [PRODIN].[softland].[iw_gsaen] enc
             INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = enc.NroInt AND m.Tipo = enc.Tipo
             INNER JOIN [PRODIN].[softland].[iw_tprod] t ON t.CodProd = m.CodProd
             WHERE LTRIM(RTRIM(enc.CodVendedor)) IN ($placeholders)
               AND enc.Estado <> 'A'
               AND enc.Tipo IN ('F','N','D')
               AND enc.Fecha >= ?
               AND enc.Fecha < ?
               AND t.CtaVentas IS NOT NULL
               AND LTRIM(RTRIM(t.CtaVentas)) <> ''
             GROUP BY LTRIM(RTRIM(enc.CodVendedor)), LTRIM(RTRIM(t.CtaVentas))
             ORDER BY codVendedor ASC, totalVentas DESC"
        );
        $stmt->execute(array_merge($codes, [$inicioMes, $finMes]));
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $totals = [];
        foreach ($rows as $row) {
            $cod = trim((string)($row['codVendedor'] ?? ''));
            $cta = trim((string)($row['ctaVentas'] ?? ''));
            if ($cod === '' || $cta === '') {
                continue;
            }

            $totals[$cod][$cta] = ($totals[$cod][$cta] ?? 0.0) + (float)($row['totalVentas'] ?? 0);
        }

        return $totals;
    }

    private function fetchSharedFolioCategoryTotals(array $folios, int $mes, int $anio): array
    {
        $folios = array_values(array_unique(array_filter(array_map(
            static fn(mixed $folio): string => trim((string)$folio),
            $folios
        ))));
        if (!$folios) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($folios), '?'));
        $inicioMes = $this->monthStart($anio, $mes);
        $finMes = (new DateTimeImmutable($inicioMes))->modify('+1 month')->format('Y-m-d');
        $pdo = $this->db->softland();
        $stmt = $pdo->prepare(
            "SELECT
                CONVERT(varchar(20), enc.Folio) AS folio,
                LTRIM(RTRIM(t.CtaVentas)) AS ctaVentas,
                SUM(m.TotLinea) AS totalVentas
             FROM [PRODIN].[softland].[iw_gsaen] enc
             INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = enc.NroInt AND m.Tipo = enc.Tipo
             INNER JOIN [PRODIN].[softland].[iw_tprod] t ON t.CodProd = m.CodProd
             WHERE CONVERT(varchar(20), enc.Folio) IN ($placeholders)
               AND enc.Estado <> 'A'
               AND enc.Tipo IN ('F','N','D')
               AND enc.Fecha >= ?
               AND enc.Fecha < ?
               AND t.CtaVentas IS NOT NULL
               AND LTRIM(RTRIM(t.CtaVentas)) <> ''
             GROUP BY CONVERT(varchar(20), enc.Folio), LTRIM(RTRIM(t.CtaVentas))
             ORDER BY folio ASC, totalVentas DESC"
        );
        $stmt->execute(array_merge($folios, [$inicioMes, $finMes]));
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $totals = [];
        foreach ($rows as $row) {
            $folio = trim((string)($row['folio'] ?? ''));
            $cta = trim((string)($row['ctaVentas'] ?? ''));
            if ($folio === '' || $cta === '') {
                continue;
            }

            $totals[$folio][$cta] = ($totals[$folio][$cta] ?? 0.0) + (float)($row['totalVentas'] ?? 0);
        }

        return $totals;
    }

    private function fetchSharedCategoryAdjustments(array $vendCodes, int $mes, int $anio): array
    {
        $codes = array_values(array_unique(array_filter(array_map(
            static fn(mixed $code): string => trim((string)$code),
            $vendCodes
        ))));
        if (!$codes) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($codes), '?'));
        $inicioMes = $this->monthStart($anio, $mes);
        $finMes = (new DateTimeImmutable($inicioMes))->modify('+1 month')->format('Y-m-d');
        $rows = $this->db->fetchAll(
            "SELECT
                CAST(fc.folio AS CHAR) AS folio,
                LTRIM(RTRIM(fc.cod_vendedor_principal)) AS codVendedorPrincipal,
                LTRIM(RTRIM(fc.cod_vendedor_compartido)) AS codVendedorCompartido,
                fc.porcentaje,
                fc.monto_neto,
                fc.monto_asignado
             FROM factura_compartida fc
             WHERE fc.rol = 'compartido'
               AND fc.fecha >= ?
               AND fc.fecha < ?
               AND (
                 LTRIM(RTRIM(fc.cod_vendedor_principal)) IN ($placeholders)
                 OR LTRIM(RTRIM(fc.cod_vendedor_compartido)) IN ($placeholders)
               )",
            array_merge([$inicioMes, $finMes], $codes, $codes)
        );

        $folios = array_values(array_unique(array_filter(array_map(
            static fn(array $row): string => trim((string)($row['folio'] ?? '')),
            $rows
        ))));
        if (!$folios) {
            return [];
        }

        $folioTotals = $this->fetchSharedFolioCategoryTotals($folios, $mes, $anio);
        $adjustments = [];

        foreach ($rows as $row) {
            $folio = trim((string)($row['folio'] ?? ''));
            if ($folio === '' || !isset($folioTotals[$folio])) {
                continue;
            }

            $factor = ((float)($row['porcentaje'] ?? 0)) / 100.0;
            if ($factor <= 0.0) {
                $montoNeto = (float)($row['monto_neto'] ?? 0);
                $montoAsignado = (float)($row['monto_asignado'] ?? 0);
                if ($montoNeto > 0.0) {
                    $factor = $montoAsignado > 0.0 ? ($montoAsignado / $montoNeto) : 0.0;
                }
            }
            $factor = max(0.0, min(1.0, $factor));
            if ($factor <= 0.0) {
                continue;
            }

            $principal = trim((string)($row['codVendedorPrincipal'] ?? ''));
            $compartido = trim((string)($row['codVendedorCompartido'] ?? ''));
            $categoriasFolio = $folioTotals[$folio];

            if ($principal !== '' && in_array($principal, $codes, true)) {
                foreach ($categoriasFolio as $cta => $total) {
                    $adjustments[$principal][$cta] = ($adjustments[$principal][$cta] ?? 0.0) - ((float)$total * $factor);
                }
            }

            if ($compartido !== '' && in_array($compartido, $codes, true)) {
                foreach ($categoriasFolio as $cta => $total) {
                    $adjustments[$compartido][$cta] = ($adjustments[$compartido][$cta] ?? 0.0) + ((float)$total * $factor);
                }
            }
        }

        return $adjustments;
    }

    private function softlandDocumentBreakdown(array $vendCodes, int $mes, int $anio): array
    {
        $codes = $this->normalizeVendorCodes($vendCodes);
        if (!$codes) {
            return [
                'F' => ['folios' => 0, 'total' => 0],
                'N' => ['folios' => 0, 'total' => 0],
                'D' => ['folios' => 0, 'total' => 0],
            ];
        }

        $placeholders = implode(',', array_fill(0, count($codes), '?'));
        $rows = $this->db->fetchAll(
            "SELECT
                enc.Tipo AS tipo,
                COUNT(DISTINCT CONCAT(LTRIM(RTRIM(enc.Tipo)), '-', CAST(enc.Folio AS VARCHAR(50)))) AS folios,
                SUM(m.TotLinea) AS total
             FROM [PRODIN].[softland].[iw_gsaen] enc
             INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = enc.NroInt AND m.Tipo = enc.Tipo
             WHERE enc.CodVendedor IN ($placeholders)
               AND enc.Estado <> 'A'
               AND MONTH(enc.Fecha) = ?
               AND YEAR(enc.Fecha) = ?
               AND {$this->softlandVentaTiposSql('enc')}
             GROUP BY enc.Tipo",
            array_merge($codes, [$mes, $anio])
        );

        $breakdown = [
            'F' => ['folios' => 0, 'total' => 0],
            'N' => ['folios' => 0, 'total' => 0],
            'D' => ['folios' => 0, 'total' => 0],
        ];

        foreach ($rows as $row) {
            $tipo = strtoupper(trim((string)($row['tipo'] ?? '')));
            if (!isset($breakdown[$tipo])) {
                continue;
            }

            $breakdown[$tipo] = [
                'folios' => (int)($row['folios'] ?? 0),
                'total' => (int)round((float)($row['total'] ?? 0)),
            ];
        }

        return $breakdown;
    }

    private function discountPercent(float $lista, float $cobrado): float
    {
        $base = abs($lista);
        if ($base <= 0.0) {
            return 0.0;
        }

        return round((1 - (abs($cobrado) / $base)) * 100, 2);
    }

    private function fetchSharedVendorRows(array $vendCodes, int $mes, int $anio): array
    {
        $codes = $this->normalizeVendorCodes($vendCodes);
        if (!$codes) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($codes), '?'));
        $rows = $this->db->fetchAll(
            "SELECT
                TRIM(fc.cod_vendedor_principal) AS codVendedor,
                COUNT(DISTINCT fc.folio) AS totalFolios,
                SUM(fc.monto_asignado) AS totalVentasCobrado,
                GROUP_CONCAT(DISTINCT TRIM(fc.cod_vendedor_principal) ORDER BY TRIM(fc.cod_vendedor_principal) SEPARATOR ',') AS codigosAsignadores
             FROM factura_compartida fc
             WHERE TRIM(fc.cod_vendedor_compartido) IN ($placeholders)
               AND fc.mes = ?
               AND fc.anio = ?
               AND fc.rol = 'compartido'
             GROUP BY TRIM(fc.cod_vendedor_principal)
             ORDER BY totalVentasCobrado DESC",
            array_merge($codes, [$mes, $anio])
        );

        return array_map(static function (array $row): array {
            $ventas = (float)($row['totalVentasCobrado'] ?? 0);
            return [
                'codVendedor' => trim((string)($row['codVendedor'] ?? '')),
                'totalFolios' => (int)($row['totalFolios'] ?? 0),
                'totalVentasCobrado' => (int)round($ventas),
                'ventaRealLista' => (int)round($ventas),
                'pctDescuento' => 0,
                'codigosAsignadores' => array_values(array_filter(array_map(
                    static fn(string $code): string => trim($code),
                    explode(',', (string)($row['codigosAsignadores'] ?? ''))
                ))),
            ];
        }, $rows);
    }

    private function fetchSharedMonthRows(array $vendCodes, int $mes, int $anio): array
    {
        $codes = $this->normalizeVendorCodes($vendCodes);
        if (!$codes) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($codes), '?'));
        $rows = $this->db->fetchAll(
            "SELECT
                fc.folio,
                fc.fecha,
                COALESCE(NULLIF(TRIM(fc.cliente), ''), CAST(fc.folio AS CHAR)) AS cliente,
                TRIM(fc.cod_vendedor_compartido) AS cod_vendedor,
                fc.monto_asignado,
                fc.porcentaje
             FROM factura_compartida fc
             WHERE TRIM(fc.cod_vendedor_compartido) IN ($placeholders)
               AND fc.mes = ?
               AND fc.anio = ?
               AND fc.rol = 'compartido'
             ORDER BY fc.fecha DESC, fc.folio DESC",
            array_merge($codes, [$mes, $anio])
        );

        return array_map(static function (array $row): array {
            $monto = (float)($row['monto_asignado'] ?? 0);
            $porcentaje = (float)($row['porcentaje'] ?? 0);
            return [
                'Folio' => (int)($row['folio'] ?? 0),
                'fecha_formato' => substr((string)($row['fecha'] ?? ''), 0, 10),
                'cliente' => trim((string)($row['cliente'] ?? '')),
                'CodAux' => '',
                'CodVendedor' => trim((string)($row['cod_vendedor'] ?? '')),
                'Tipo' => 'F',
                'monto' => (int)round($monto),
                'venta_real_folio' => (int)round($monto),
                'venta_lista_folio' => (int)round($monto),
                'TotLineaReal' => (int)round($monto),
                'pct_descuento' => 0,
                'es_compartido' => true,
                'monto_asignado' => (int)round($monto),
                'porcentaje_asignado' => $porcentaje,
            ];
        }, $rows);
    }

    private function fetchSharedVendorBalances(array $vendCodes, int $mes, int $anio): array
    {
        $codes = $this->normalizeVendorCodes($vendCodes);
        if (!$codes) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($codes), '?'));
        $balances = [];

        $outgoingRows = $this->db->fetchAll(
            "SELECT
                TRIM(fc.cod_vendedor_principal) AS codVendedor,
                COUNT(DISTINCT fc.folio) AS totalFolios,
                SUM(fc.monto_asignado) AS monto
             FROM factura_compartida fc
             WHERE TRIM(fc.cod_vendedor_principal) IN ($placeholders)
               AND fc.mes = ?
               AND fc.anio = ?
               AND fc.rol = 'compartido'
             GROUP BY TRIM(fc.cod_vendedor_principal)",
            array_merge($codes, [$mes, $anio])
        );

        foreach ($outgoingRows as $row) {
            $code = trim((string)($row['codVendedor'] ?? ''));
            if ($code === '') {
                continue;
            }

            $balances[$code]['outgoing'] = (float)($row['monto'] ?? 0);
            $balances[$code]['outgoing_folios'] = (int)($row['totalFolios'] ?? 0);
        }

        $incomingRows = $this->db->fetchAll(
            "SELECT
                TRIM(fc.cod_vendedor_compartido) AS codVendedor,
                COUNT(DISTINCT fc.folio) AS totalFolios,
                SUM(fc.monto_asignado) AS monto
             FROM factura_compartida fc
             WHERE TRIM(fc.cod_vendedor_compartido) IN ($placeholders)
               AND fc.mes = ?
               AND fc.anio = ?
               AND fc.rol = 'compartido'
             GROUP BY TRIM(fc.cod_vendedor_compartido)",
            array_merge($codes, [$mes, $anio])
        );

        foreach ($incomingRows as $row) {
            $code = trim((string)($row['codVendedor'] ?? ''));
            if ($code === '') {
                continue;
            }

            $balances[$code]['incoming'] = (float)($row['monto'] ?? 0);
            $balances[$code]['incoming_folios'] = (int)($row['totalFolios'] ?? 0);
        }

        return $balances;
    }

    private function fetchSharedMonthlyBalances(array $vendCodes, int $anio): array
    {
        $codes = $this->normalizeVendorCodes($vendCodes);
        if (!$codes) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($codes), '?'));
        $rows = $this->db->fetchAll(
            "SELECT
                fc.mes,
                SUM(CASE WHEN TRIM(fc.cod_vendedor_compartido) IN ($placeholders) THEN fc.monto_asignado ELSE 0 END) AS incoming,
                SUM(CASE WHEN TRIM(fc.cod_vendedor_principal) IN ($placeholders) THEN fc.monto_asignado ELSE 0 END) AS outgoing
             FROM factura_compartida fc
             WHERE fc.anio = ?
               AND fc.rol = 'compartido'
             GROUP BY fc.mes",
            array_merge($codes, $codes, [$anio])
        );

        $balances = [];
        foreach ($rows as $row) {
            $mes = (int)($row['mes'] ?? 0);
            if ($mes < 1 || $mes > 12) {
                continue;
            }

            $balances[$mes] = (float)($row['incoming'] ?? 0) - (float)($row['outgoing'] ?? 0);
        }

        return $balances;
    }

    private function sortMonthSalesRows(array $rows): array
    {
        usort($rows, static function (array $a, array $b): int {
            $fechaA = (string)($a['fecha_formato'] ?? '');
            $fechaB = (string)($b['fecha_formato'] ?? '');
            if ($fechaA !== $fechaB) {
                return strcmp($fechaB, $fechaA);
            }

            return (int)($b['Folio'] ?? 0) <=> (int)($a['Folio'] ?? 0);
        });

        return $rows;
    }

    private function uniqueMonthRows(array $rows): array
    {
        $seen = [];
        $unique = [];

        foreach ($rows as $row) {
            $folio = trim((string)($row['Folio'] ?? $row['folio'] ?? ''));
            $tipo = trim((string)($row['Tipo'] ?? $row['tipo'] ?? 'F'));
            $key = $tipo . '|' . $folio;
            if ($folio === '' || isset($seen[$key])) {
                continue;
            }

            $seen[$key] = true;
            $unique[] = $row;
        }

        return $unique;
    }

    private function salesRowKey(array $row): string
    {
        $tipo = strtoupper(trim((string)($row['Tipo'] ?? $row['tipo'] ?? 'F')));
        $folio = trim((string)($row['Folio'] ?? $row['folio'] ?? ''));
        return $tipo . '|' . $folio;
    }

    private function summarizeSalesRows(array $rows): array
    {
        $seen = [];
        $folios = 0;
        $totalVentas = 0.0;
        $ventaReal = 0.0;

        foreach ($rows as $row) {
            $key = $this->salesRowKey($row);
            if ($key === '|' || isset($seen[$key])) {
                continue;
            }

            $seen[$key] = true;
            $folios++;
            $totalVentas += (float)($row['monto'] ?? $row['totalVentasCobrado'] ?? $row['monto_asignado'] ?? 0);
            $ventaReal += (float)($row['TotLineaReal'] ?? $row['venta_real_folio'] ?? $row['ventaRealLista'] ?? $row['monto_asignado'] ?? 0);
        }

        return [
            'folios' => $folios,
            'total_ventas' => (int)round($totalVentas),
            'venta_real' => (int)round($ventaReal),
            'keys' => array_keys($seen),
        ];
    }

    private function duplicateSalesRows(array $primaryRows, array $secondaryRows): array
    {
        $primary = [];
        foreach ($primaryRows as $row) {
            $primary[$this->salesRowKey($row)] = true;
        }

        $duplicates = [];
        foreach ($secondaryRows as $row) {
            $key = $this->salesRowKey($row);
            if ($key === '|' || !isset($primary[$key]) || isset($duplicates[$key])) {
                continue;
            }

            $duplicates[$key] = [
                'tipo' => strtoupper(trim((string)($row['Tipo'] ?? $row['tipo'] ?? 'F'))),
                'folio' => trim((string)($row['Folio'] ?? $row['folio'] ?? '')),
            ];
        }

        return array_values($duplicates);
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
             WHERE %s
               AND enc.Estado <> 'A'
               AND enc.CodVendedor IN (%s)
               AND MONTH(enc.Fecha) = ? AND YEAR(enc.Fecha) = ?",
            $this->softlandVentaTiposSql('enc'),
            implode(',', array_fill(0, count($vendCodes), '?'))
        );
        $stmt = $pool->prepare($sql);
        $stmt->execute(array_merge($vendCodes, [$mes, $anio]));
        $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
        $ventas = (float)($row['totalVentasCobrado'] ?? 0);
        $lista = (float)($row['totalVentasLista'] ?? 0);
        foreach ($this->fetchSharedVendorBalances($vendCodes, $mes, $anio) as $balance) {
            $ventas += (float)($balance['incoming'] ?? 0) - (float)($balance['outgoing'] ?? 0);
            $lista += (float)($balance['incoming'] ?? 0) - (float)($balance['outgoing'] ?? 0);
        }

        $metaMes = (float)$meta['meta_mes'];
        $progreso = $metaMes > 0 ? (int)round(($ventas / $metaMes) * 100) : 0;

        $result = [
            'ok' => true,
            'totalVentas' => (int)round($ventas),
            'meta' => (int)round($metaMes),
            'progreso' => $progreso,
            'pctDescuentoGlobal' => $lista > 0 ? round((1 - ($ventas / $lista)) * 100, 2) : 0,
        ];

        if (filter_var($query['debug'] ?? false, FILTER_VALIDATE_BOOL)) {
            $ventasPropias = $this->ventasMes($payload, [
                'mes' => $mes,
                'anio' => $anio,
            ])['ventas'] ?? [];
            $ventasAsignadas = $this->fetchSharedMonthRows($vendCodes, $mes, $anio);
            $ventasPropiasResumen = $this->summarizeSalesRows($ventasPropias);
            $ventasAsignadasResumen = $this->summarizeSalesRows($ventasAsignadas);
            $duplicados = $this->duplicateSalesRows($ventasPropias, $ventasAsignadas);
            $combined = $this->uniqueMonthRows(array_merge($ventasPropias, $ventasAsignadas));
            $combinedResumen = $this->summarizeSalesRows($combined);
            $totalSinDedupe = (int)round((float)$ventasPropiasResumen['total_ventas'] + (float)$ventasAsignadasResumen['total_ventas']);

            $tipoBreakdown = $this->softlandDocumentBreakdown($vendCodes, $mes, $anio);
            $ventasCompartidasRecibidas = 0;
            $ventasCompartidasEntregadas = 0;
            foreach ($this->fetchSharedVendorBalances($vendCodes, $mes, $anio) as $balance) {
                $ventasCompartidasRecibidas += (float)($balance['incoming'] ?? 0);
                $ventasCompartidasEntregadas += (float)($balance['outgoing'] ?? 0);
            }

            $result['debug'] = [
                'periodo' => [
                    'anio' => $anio,
                    'mes' => $mes,
                    'fecha_inicio' => $this->monthStart($anio, $mes),
                    'fecha_fin' => (new DateTimeImmutable($this->monthStart($anio, $mes)))->modify('+1 month')->format('Y-m-d'),
                ],
                'codigos_vendedor' => array_values($vendCodes),
                'documentos_por_tipo' => $tipoBreakdown,
                'ventas_softland_netas' => (int)$ventasPropiasResumen['total_ventas'],
                'ventas_compartidas_recibidas' => (int)round($ventasCompartidasRecibidas),
                'ventas_compartidas_entregadas' => (int)round($ventasCompartidasEntregadas),
                'ventas_propias_softland' => [
                    'folios' => (int)$ventasPropiasResumen['folios'],
                    'total_ventas' => (int)$ventasPropiasResumen['total_ventas'],
                    'venta_real' => (int)$ventasPropiasResumen['venta_real'],
                ],
                'ventas_asignadas' => [
                    'folios' => (int)$ventasAsignadasResumen['folios'],
                    'total_ventas' => (int)$ventasAsignadasResumen['total_ventas'],
                    'venta_real' => (int)$ventasAsignadasResumen['venta_real'],
                ],
                'total_sin_deduplicar' => $totalSinDedupe,
                'duplicados_detectados' => $duplicados,
                'total_dashboard_final' => (int)$combinedResumen['total_ventas'],
                'total_esperado_reporte' => (int)$combinedResumen['total_ventas'],
                'diferencia_vs_reporte' => 0,
            ];
        }

        return $result;
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
             WHERE %s
               AND enc.CodVendedor IN (%s)
               AND YEAR(enc.Fecha) = ?
               AND enc.Estado <> 'A'
             GROUP BY MONTH(enc.Fecha)
             ORDER BY mes",
            $this->softlandVentaTiposSql('enc'),
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

        foreach ($this->fetchSharedMonthlyBalances($vendCodes, $anio) as $mes => $balance) {
            if ($mes >= 1 && $mes <= 12) {
                $evolucion[$mes - 1]['ventas'] += (int)round($balance);
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
                LTRIM(RTRIM(enc.CodVendedor)) AS codVendedor,
                MIN(enc.NomAux) AS nombreVendedor,
                COUNT(DISTINCT CONCAT(LTRIM(RTRIM(enc.Tipo)), '-', CAST(enc.Folio AS VARCHAR(50)))) AS totalFolios,
                SUM(m.TotLinea) AS totalVentasCobrado,
                SUM(m.CantFacturada * ISNULL(t.PrecioVta, 0)) AS ventaRealLista
             FROM [PRODIN].[softland].[iw_gsaen] enc
             INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = enc.NroInt AND m.Tipo = enc.Tipo
             INNER JOIN [PRODIN].[softland].[iw_tprod] t ON t.CodProd = m.CodProd
             WHERE %s
               AND enc.CodVendedor IN (%s)
               AND enc.Estado <> 'A'
               AND MONTH(enc.Fecha) = ? AND YEAR(enc.Fecha) = ?
             GROUP BY LTRIM(RTRIM(enc.CodVendedor))
             ORDER BY totalVentasCobrado DESC",
            $this->softlandVentaTiposSql('enc'),
            implode(',', array_fill(0, count($vendCodes), '?'))
        );
        $stmt = $pool->prepare($sql);
        $stmt->execute(array_merge($vendCodes, [$mes, $anio]));
        $rows = [];
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $codigo = trim((string)$row['codVendedor']);
            $ventas = (float)($row['totalVentasCobrado'] ?? 0);
            $lista = (float)($row['ventaRealLista'] ?? 0);
            $rows[] = [
                'codVendedor' => $codigo,
                'nombreVendedor' => $this->getVendorName($codigo),
                'totalFolios' => (int)($row['totalFolios'] ?? 0),
                'totalVentasCobrado' => $ventas,
                'ventaRealLista' => $lista,
                'pctDescuento' => $lista > 0 ? round((1 - ($ventas / $lista)) * 100, 2) : 0,
            ];
        }

        $balances = $this->fetchSharedVendorBalances($vendCodes, $mes, $anio);
        foreach ($rows as &$row) {
            $codigo = trim((string)($row['codVendedor'] ?? ''));
            if ($codigo === '' || !isset($balances[$codigo])) {
                continue;
            }

            $balance = $balances[$codigo];
            $ajuste = (float)($balance['incoming'] ?? 0) - (float)($balance['outgoing'] ?? 0);

            $row['totalVentasCobrado'] = (float)($row['totalVentasCobrado'] ?? 0) + $ajuste;
            $row['ventaRealLista'] = (float)($row['ventaRealLista'] ?? 0) + $ajuste;
            $ventasAjustadas = (float)($row['totalVentasCobrado'] ?? 0);
            $listaAjustada = (float)($row['ventaRealLista'] ?? 0);
            $row['pctDescuento'] = $listaAjustada > 0 ? round((1 - ($ventasAjustadas / $listaAjustada)) * 100, 2) : 0;

            unset($balances[$codigo]);
        }
        unset($row);

        foreach ($balances as $codigo => $balance) {
            $ajuste = (float)($balance['incoming'] ?? 0) - (float)($balance['outgoing'] ?? 0);
            $ventas = $ajuste;
            $lista = $ajuste;
            $rows[] = [
                'codVendedor' => $codigo,
                'nombreVendedor' => $this->getVendorName($codigo),
                'totalFolios' => 0,
                'totalVentasCobrado' => $ventas,
                'ventaRealLista' => $lista,
                'pctDescuento' => $lista > 0 ? round((1 - ($ventas / $lista)) * 100, 2) : 0,
            ];
        }

        usort(
            $rows,
            static fn(array $a, array $b): int => ($b['totalVentasCobrado'] <=> $a['totalVentasCobrado'])
                ?: strcasecmp((string)$a['codVendedor'], (string)$b['codVendedor'])
        );

        $totalVentas = array_reduce($rows, static fn(float $acc, array $row): float => $acc + (float)($row['totalVentasCobrado'] ?? 0), 0.0);
        $ventaReal = array_reduce($rows, static fn(float $acc, array $row): float => $acc + (float)($row['ventaRealLista'] ?? 0), 0.0);

        return [
            'ok' => true,
            'vendedores' => $rows,
            'totales' => [
                'totalVentasCobrado' => (int)round($totalVentas),
                'ventaRealLista' => (int)round($ventaReal),
                'pctDescuento' => $ventaReal > 0 ? round((1 - ($totalVentas / $ventaReal)) * 100, 2) : 0,
            ],
        ];
    }

    public function ventasCompartidasRecibidasResumen(array $payload, array $query): array
    {
        $vendCodes = array_values(array_unique(array_filter(array_map(
            static fn(mixed $code): string => trim((string)$code),
            $this->vendorCodes($payload)
        ))));
        if (!$vendCodes) {
            return [
                'ok' => true,
                'ventasCompartidasRecibidas' => [],
                'totales' => ['folios' => 0, 'monto' => 0],
            ];
        }

        $periodo = $this->monthYear($query);
        $mes = $periodo['mes'];
        $anio = $periodo['anio'];
        $placeholders = implode(',', array_fill(0, count($vendCodes), '?'));

        $rows = $this->db->fetchAll(
            "SELECT
                TRIM(fc.cod_vendedor_principal) AS CodigoAsignador,
                COALESCE(
                    NULLIF(TRIM(u.nombre), ''),
                    TRIM(fc.cod_vendedor_principal)
                ) AS NombreAsignador,
                COUNT(DISTINCT fc.folio) AS FoliosAsignados,
                SUM(fc.monto_asignado) AS MontoAsignado
             FROM factura_compartida fc
             LEFT JOIN usuario_vendedor uv
                ON TRIM(uv.cod_vendedor) = TRIM(fc.cod_vendedor_principal)
             LEFT JOIN usuario u
                ON u.id = uv.usuario_id
             WHERE TRIM(fc.cod_vendedor_compartido) IN ($placeholders)
               AND fc.mes = ?
               AND fc.anio = ?
               AND fc.rol = 'compartido'
             GROUP BY
                TRIM(fc.cod_vendedor_principal),
                u.nombre
             ORDER BY MontoAsignado DESC, CodigoAsignador ASC",
            array_merge($vendCodes, [$mes, $anio])
        );

        $rows = array_map(static function (array $row): array {
            return [
                'CodigoAsignador' => trim((string)($row['CodigoAsignador'] ?? '')),
                'NombreAsignador' => trim((string)($row['NombreAsignador'] ?? '')),
                'FoliosAsignados' => (int)($row['FoliosAsignados'] ?? 0),
                'MontoAsignado' => (float)($row['MontoAsignado'] ?? 0),
            ];
        }, $rows);

        return [
            'ok' => true,
            'ventasCompartidasRecibidas' => $rows,
            'totales' => [
                'folios' => array_sum(array_map(static fn(array $row): int => (int)($row['FoliosAsignados'] ?? 0), $rows)),
                'monto' => array_sum(array_map(static fn(array $row): float => (float)($row['MontoAsignado'] ?? 0), $rows)),
            ],
        ];
    }

    public function ventasMes(array $payload, array $query): array
    {
        $userId = $this->currentUserIdFromPayload($payload);
        $vendCodes = $this->getVendorCodes($userId);
        $params = $this->monthYear($query);
        $mes = $params['mes'];
        $anio = $params['anio'];
        $includeCompartidas = filter_var($query['include_compartidas'] ?? false, FILTER_VALIDATE_BOOL);

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
             WHERE %s
                AND enc.CodVendedor IN (%s)
                AND enc.Estado <> 'A'
                AND MONTH(enc.Fecha) = ? AND YEAR(enc.Fecha) = ?
             GROUP BY enc.Folio, enc.Fecha, enc.CodAux, CONVERT(varchar(max), enc.NomAux), CONVERT(varchar(max), c.NomAux), enc.CodVendedor, enc.Tipo
             ORDER BY enc.Fecha DESC, enc.Folio DESC",
            $this->softlandVentaTiposSql('enc'),
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

        if ($includeCompartidas) {
            $ventas = array_merge($ventas, $this->fetchSharedMonthRows($vendCodes, $mes, $anio));
            $ventas = $this->uniqueMonthRows($ventas);
            $ventas = $this->sortMonthSalesRows($ventas);
        }

        return ['ok' => true, 'ventas' => $ventas];
    }

    public function vendedoresTodos(array $payload): array
    {
        $this->currentUserIdFromPayload($payload);
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
        return $this->carteraOptimizada($payload, $query);
    }

    private function carteraOptimizada(array $payload, array $query): array
    {
        @set_time_limit(120);

        $userId = $this->currentUserIdFromPayload($payload);
        $vendCodes = array_values(array_unique(array_filter(array_map(
            static fn(mixed $value): string => trim((string)$value),
            $this->getVendorCodes($userId)
        ))));
        $codVendedorFiltro = trim((string)($query['cod_vendedor'] ?? ''));
        $codVendedorFiltroValido = null;
        if ($codVendedorFiltro !== '') {
            $codVendedorFiltro = Security::validate_cod_vendedor($codVendedorFiltro);
            if (in_array($codVendedorFiltro, $vendCodes, true)) {
                $codVendedorFiltroValido = $codVendedorFiltro;
                $vendCodes = [$codVendedorFiltro];
            } else {
                $vendCodes = [];
            }
        }
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
            $empty = [
                'ok' => true,
                'TotalClientes' => 0,
                'ClientesActivos' => 0,
                'ClientesInactivos' => 0,
                'ClientesNuevos' => 0,
                'ClientesRecuperados' => 0,
                'total' => [], 'activos' => [], 'inactivos' => [], 'nuevos' => [], 'recuperados' => [], 'activosMesActual' => [],
            ];

            if (filter_var($query['debug'] ?? false, FILTER_VALIDATE_BOOL)) {
                $empty['debug'] = [
                    'usuario_id' => $userId,
                    'codigos_usuario_vendedor_exactos' => $vendCodes,
                    'cod_vendedor_filtro' => $codVendedorFiltroValido,
                    'clientes_devueltos_por_cwtauxven' => [],
                ];
            }

            return $empty;
        }

                $paramsPurchases = [];
        $inPurchases = $this->inClause($clientCodes, $paramsPurchases);
        $fechaDesde = $desde->format('Y-m-d');
        $fechaHasta = $hasta->format('Y-m-d');
        $fechaActivaDesde = $ventanaActiva->format('Y-m-d');

        $stmt = $pool->prepare(
            "SELECT h.CodAux,
                    MIN(CONVERT(date, h.Fecha)) AS FechaPrimera,
                    MAX(CONVERT(date, h.Fecha)) AS FechaUltima,
                    MIN(CASE WHEN h.Fecha >= ? AND h.Fecha <= ? THEN CONVERT(date, h.Fecha) END) AS FechaMinMesActual,
                    MAX(CASE WHEN h.Fecha >= ? AND h.Fecha <= ? THEN 1 ELSE 0 END) AS TieneMesActual,
                    MAX(CASE WHEN h.Fecha < ? THEN 1 ELSE 0 END) AS TieneHistorialPrevio,
                    MAX(CASE WHEN h.Fecha >= ? THEN 1 ELSE 0 END) AS EsActivo,
                    MAX(NULLIF(LTRIM(RTRIM(CONVERT(varchar(max), a.NomAux))), '')) AS NomAux,
                    MAX(NULLIF(LTRIM(RTRIM(CONVERT(varchar(max), a.FonAux1))), '')) AS FONAux1,
                    MAX(NULLIF(LTRIM(RTRIM(CONVERT(varchar(max), a.FonAux2))), '')) AS FonAux2,
                    MAX(NULLIF(LTRIM(RTRIM(CONVERT(varchar(max), a.EMail))), '')) AS EMail
             FROM [PRODIN].[softland].[iw_gsaen] h
             INNER JOIN [PRODIN].[softland].[cwtauxi] a ON a.CodAux = h.CodAux
             WHERE h.CodAux IN ($inPurchases)
               AND h.Tipo IN ('F','N','D')
               AND h.Estado <> 'A'
               AND h.Fecha <= ?
             GROUP BY h.CodAux
             ORDER BY h.CodAux ASC"
        );
        $stmt->execute(array_merge(
            [$fechaDesde, $fechaHasta, $fechaDesde, $fechaHasta, $fechaDesde, $fechaActivaDesde],
            $paramsPurchases,
            [$fechaHasta]
        ));

        $rows = [];
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $codAux = trim((string)($row['CodAux'] ?? ''));
            if ($codAux === '') {
                continue;
            }

            $fechaUltima = !empty($row['FechaUltima']) ? new DateTimeImmutable((string)$row['FechaUltima']) : null;
            $fechaPrimera = !empty($row['FechaPrimera']) ? new DateTimeImmutable((string)$row['FechaPrimera']) : null;
            $fechaMinMes = !empty($row['FechaMinMesActual']) ? new DateTimeImmutable((string)$row['FechaMinMesActual']) : null;

            $esActivo = (bool)($row['EsActivo'] ?? 0);
            $esInactivo = !$esActivo;
            $esNuevo = $fechaPrimera && $fechaPrimera >= $desde && $fechaPrimera <= $hasta;
            $esRecuperado = !$esNuevo && (bool)($row['TieneHistorialPrevio'] ?? 0) && (bool)($row['TieneMesActual'] ?? 0);
            $esActivoMesActual = (bool)($row['TieneMesActual'] ?? 0);

            $rows[] = [
                'CodAux' => $codAux,
                'NomAux' => trim((string)($row['NomAux'] ?? '')),
                'FONAUX1' => trim((string)($row['FONAux1'] ?? '')),
                'FonAux2' => trim((string)($row['FonAux2'] ?? '')),
                'EMail' => trim((string)($row['EMail'] ?? '')),
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

        $result = [
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

        if (filter_var($query['debug'] ?? false, FILTER_VALIDATE_BOOL)) {
            $result['debug'] = [
                'usuario_id' => $userId,
                'codigos_usuario_vendedor_exactos' => array_values($vendCodes),
                'cod_vendedor_filtro' => $codVendedorFiltroValido,
                'clientes_devueltos_por_cwtauxven' => array_values(array_unique($clientCodes)),
            ];
        }

        return $result;
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
        $codes = $this->normalizeVendorCodes($this->vendorCodes($payload));
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
                         WHERE TRIM(fc.cod_vendedor_compartido) IN ($placeholders)
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
        $coordinatorCodes = $this->normalizeVendorCodes($this->coordinatorCodes($payload));
        $vendorCodes = $this->normalizeVendorCodes($this->vendorCodes($payload));

        $conditions = [];
        $params = [];

        if ($coordinatorCodes) {
            $conditions[] = 'TRIM(fc.cod_vendedor_principal) IN (' . implode(',', array_fill(0, count($coordinatorCodes), '?')) . ')';
            $params = array_merge($params, $coordinatorCodes);
        }

        if ($vendorCodes) {
            $conditions[] = 'TRIM(fc.cod_vendedor_compartido) IN (' . implode(',', array_fill(0, count($vendorCodes), '?')) . ')';
            $params = array_merge($params, $vendorCodes);
        }

        if (!$conditions) {
            return ['ok' => true, 'asignados' => [], 'periodo_solicitado' => null, 'periodo_utilizado' => null];
        }

        $periodoSolicitado = $this->monthYear($query);
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
            WHERE (" . implode(' OR ', $conditions) . ")
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
        $rawCodes = array_values(array_unique(array_filter(array_map(
            static fn(mixed $code): string => trim((string)$code),
            $this->vendorCodes($payload)
        ))));
        if (!$rawCodes) {
            return ['vendedores' => [], 'todasLasCategorias' => []];
        }

        $periodo = $this->monthYear($query);
        $mes = $periodo['mes'];
        $anio = $periodo['anio'];
        $catalogo = $this->fetchCategoriaCatalogo();
        $catMap = $catalogo['mapa'];
        $todasLasCategorias = $catalogo['categorias'];

        $directTotals = $this->fetchDirectCategoryTotals($rawCodes, $mes, $anio);
        $sharedAdjustments = $this->fetchSharedCategoryAdjustments($rawCodes, $mes, $anio);

        $resultado = [];
        foreach ($rawCodes as $cod) {
            $totalesPorCategoria = [];

            foreach (($directTotals[$cod] ?? []) as $cta => $total) {
                $categoria = $catMap[$cta] ?? 'Otros';
                $totalesPorCategoria[$categoria] = ($totalesPorCategoria[$categoria] ?? 0.0) + (float)$total;
            }

            foreach (($sharedAdjustments[$cod] ?? []) as $cta => $ajuste) {
                $categoria = $catMap[$cta] ?? 'Otros';
                $totalesPorCategoria[$categoria] = ($totalesPorCategoria[$categoria] ?? 0.0) + (float)$ajuste;
            }

            $categorias = [];
            foreach ($totalesPorCategoria as $categoria => $total) {
                if ($total <= 0) {
                    continue;
                }
                $categorias[] = ['categoria' => $categoria, 'total' => (int)round($total)];
            }

            usort($categorias, static fn(array $a, array $b): int => $b['total'] <=> $a['total']);
            $resultado[] = ['codVendedor' => $cod, 'categorias' => $categorias];

            foreach ($categorias as $item) {
                $todasLasCategorias[] = (string)($item['categoria'] ?? '');
            }
        }

        return [
            'vendedores' => $resultado,
            'todasLasCategorias' => array_values(array_unique(array_filter($todasLasCategorias))),
            'debug' => filter_var($query['debug'] ?? false, FILTER_VALIDATE_BOOL) ? [
                'codes' => $rawCodes,
                'directTotals' => $directTotals,
                'sharedAdjustments' => $sharedAdjustments,
                'categoriaMapCount' => count($catMap),
            ] : null,
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


