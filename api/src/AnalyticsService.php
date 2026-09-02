<?php
declare(strict_types=1);

final class AnalyticsService
{
    use SharedServiceHelpers;

    private ?string $quoteVendorField = null;

    public function __construct(private Database $db)
    {
    }

    public function dashboardForUser(int $userId, array $query): array
    {
        $payload = ['sub' => $userId];
        $resumen = $this->resumen($payload, $query);
        $evolucion = $this->evolucion($payload, $query);
        $vendedores = $this->vendedores($payload, $query, true);
        $vendedores['vendedores'] = $this->completarCodigosVendedor($userId, $vendedores['vendedores'] ?? []);
        $periodo = $this->monthYear($query);
        $codigos = $this->normalizeVendorCodes($this->getVendorCodes($userId));
        $asignacionesCompartidas = $this->fetchSharedAssignments($codigos, $periodo['mes'], $periodo['anio']);
        $productosCompartidos = $this->sharedProductCategories($asignacionesCompartidas, $periodo['mes'], $periodo['anio']);
        $categorias = $this->sharedCategoryDistribution(
            $codigos,
            $periodo['mes'],
            $periodo['anio'],
            $asignacionesCompartidas,
            $productosCompartidos,
            $this->vendorCodeTypeMapFromUserId($userId)
        );
        $totalCategorias = array_sum(array_column($categorias, 'total'));
        $ventasCompartidas = $this->sharedSalesOriginSummary($codigos, $asignacionesCompartidas, $productosCompartidos);
        $clientes = $this->clientesResumen($payload, $query);
        $cartera = $this->carteraForUser($userId, $query, 180, 180);
        $clientesNuevosCalendario = $this->clientesNuevosCalendarioForUser($userId, $query);
        $cotizaciones = $this->cotizacionesResumenForUser($userId, $query);
        $guiasPendientes = $this->pendingGuidesForUser($codigos, $periodo['mes'], $periodo['anio']);

        return [
            'ok' => true,
            'resumen' => $resumen,
            'evolucion' => $evolucion['evolucion'] ?? [],
            'vendedores' => $vendedores['vendedores'] ?? [],
            'totales' => $vendedores['totales'] ?? [
                'totalVentasCobrado' => 0,
                'ventaRealLista' => 0,
                'pctDescuento' => 0,
            ],
            'categorias' => $categorias,
            'totalCategorias' => $totalCategorias,
            'ventasCompartidas' => $ventasCompartidas,
            'clientes' => $clientes,
            'cartera' => $cartera,
            'clientesNuevosCalendario' => $clientesNuevosCalendario,
            'cotizaciones' => $cotizaciones,
            'guiasPendientes' => $guiasPendientes,
        ];
    }

    private function pendingGuidesForUser(array $vendorCodes, int $month, int $year): array
    {
        $codes = $this->normalizeVendorCodes($vendorCodes);
        if (!$codes) {
            return ['total' => 0, 'folios' => 0];
        }

        $start = new DateTimeImmutable($this->monthStart($year, $month));
        $placeholders = implode(',', array_fill(0, count($codes), '?'));
        $stmt = $this->softland()->prepare(
            "SELECT
                COALESCE(SUM(CONVERT(decimal(38, 2), enc.SubTotal)), 0) AS totalPendiente,
                COUNT(DISTINCT enc.Folio) AS cantidadFolios
             FROM [PRODIN].[softland].[iw_gsaen] enc
             WHERE enc.Fecha >= ?
               AND enc.Fecha < ?
               AND enc.Concepto = ?
               AND enc.Tipo = ?
               AND enc.Factura = ?
               AND enc.Estado = ?
               AND LTRIM(RTRIM(enc.CodVendedor)) IN ($placeholders)"
        );
        $stmt->execute(array_merge([
            $start->format('Y-m-d'),
            $start->modify('first day of next month')->format('Y-m-d'),
            '01',
            'S',
            0,
            'V',
        ], $codes));
        $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];

        return [
            'total' => (int)round((float)($row['totalPendiente'] ?? 0)),
            'folios' => (int)($row['cantidadFolios'] ?? 0),
        ];
    }

    public function pendingGuidesDetailForUser(int $userId, int $month, int $year): array
    {
        $codes = $this->normalizeVendorCodes($this->getVendorCodes($userId));
        if (!$codes) {
            return ['ok' => true, 'cantidad' => 0, 'monto' => 0, 'items' => []];
        }

        $start = new DateTimeImmutable($this->monthStart($year, $month));
        $placeholders = implode(',', array_fill(0, count($codes), '?'));
        $stmt = $this->softland()->prepare(
            "SELECT
                CONVERT(varchar(50), enc.Folio) AS numero,
                CONVERT(varchar(10), enc.Fecha, 23) AS fecha,
                LTRIM(RTRIM(CONVERT(varchar(50), enc.CodAux))) AS codigoCliente,
                LTRIM(RTRIM(aux.NomAux)) AS cliente,
                CONVERT(decimal(38, 2), enc.SubTotal) AS monto
             FROM [PRODIN].[softland].[iw_gsaen] enc
             LEFT JOIN [PRODIN].[softland].[cwtauxi] aux
                ON LTRIM(RTRIM(aux.CodAux)) = LTRIM(RTRIM(enc.CodAux))
             WHERE enc.Fecha >= ?
               AND enc.Fecha < ?
               AND enc.Concepto = ?
               AND enc.Tipo = ?
               AND enc.Factura = ?
               AND enc.Estado = ?
               AND LTRIM(RTRIM(enc.CodVendedor)) IN ($placeholders)
             ORDER BY enc.Fecha DESC, enc.Folio DESC"
        );
        $stmt->execute(array_merge([
            $start->format('Y-m-d'),
            $start->modify('first day of next month')->format('Y-m-d'),
            '01',
            'S',
            0,
            'V',
        ], $codes));
        $items = array_map(static function (array $row): array {
            $codigoCliente = trim((string)($row['codigoCliente'] ?? ''));
            $cliente = trim((string)($row['cliente'] ?? ''));
            return [
                'numero' => trim((string)($row['numero'] ?? '')),
                'fecha' => substr((string)($row['fecha'] ?? ''), 0, 10),
                'codigoCliente' => $codigoCliente,
                'cliente' => $cliente !== '' ? $cliente : $codigoCliente,
                'monto' => (float)($row['monto'] ?? 0),
            ];
        }, $stmt->fetchAll(PDO::FETCH_ASSOC));

        return [
            'ok' => true,
            'cantidad' => count($items),
            'monto' => (int)round(array_sum(array_column($items, 'monto'))),
            'items' => $items,
        ];
    }

    private function emptyNewClientsCalendar(int $selectedYear, array $codes, string $selectedCode = ''): array
    {
        $years = [];
        foreach ([$selectedYear - 1, $selectedYear] as $year) {
            $months = [];
            for ($month = 1; $month <= 12; $month++) {
                $months[] = ['mes' => $month, 'cantidad' => 0, 'monto' => 0];
            }
            $years[(string)$year] = [
                'anio' => $year,
                'meses' => $months,
                'totalCantidad' => 0,
                'totalMonto' => 0,
            ];
        }

        return [
            'anioAnterior' => $selectedYear - 1,
            'anioSeleccionado' => $selectedYear,
            'codigoSeleccionado' => $selectedCode,
            'codigos' => $codes,
            'anios' => array_values($years),
        ];
    }

    public function clientesNuevosCalendarioForUser(int $userId, array $query): array
    {
        if ($userId <= 0) {
            throw new RuntimeException('Vendedor invalido.', 400);
        }

        $selectedYear = (int)($query['anio'] ?? 0);
        $maxYear = (int)date('Y') + 1;
        if ($selectedYear < 2000 || $selectedYear > $maxYear) {
            throw new RuntimeException("El ano debe estar entre 2000 y {$maxYear}.", 400);
        }

        $rawCodes = array_values(array_unique(array_filter(array_map(
            static fn(mixed $code): string => trim((string)$code),
            $this->getVendorCodes($userId)
        ))));
        $codeOptions = array_map(fn(string $code): array => [
            'codigo' => $code,
            'nombre' => $this->getVendorName($code),
        ], $rawCodes);
        $vendorCodes = $this->normalizeVendorCodes($rawCodes);
        $selectedCode = trim((string)($query['cod_vendedor'] ?? ''));
        if ($selectedCode !== '') {
            $selectedCode = Security::validate_cod_vendedor($selectedCode);
            $filteredCodes = array_values(array_intersect(
                $vendorCodes,
                $this->normalizeVendorCodes([$selectedCode])
            ));
            if (!$filteredCodes) {
                throw new RuntimeException('El codigo no pertenece al vendedor seleccionado.', 404);
            }
            $vendorCodes = $filteredCodes;
        }

        $calendar = $this->emptyNewClientsCalendar($selectedYear, $codeOptions, $selectedCode);
        if (!$vendorCodes) {
            return $calendar;
        }

        $codeTypeMap = $this->vendorCodeTypeMapFromUserId($userId);
        $sharedOriginCodes = array_values(array_filter(
            $vendorCodes,
            fn(string $code): bool => $this->vendorCodeParticipationFactor(
                $this->vendorCodeType($code, $codeTypeMap)
            ) < 1.0
        ));
        $participationExpression = $sharedOriginCodes
            ? 'CASE WHEN LTRIM(RTRIM(h.CodVendedor)) IN ('
                . implode(',', array_fill(0, count($sharedOriginCodes), '?'))
                . ') THEN 0.5 ELSE 1.0 END'
            : '1.0';

        $pool = $this->softland();
        $placeholders = implode(',', array_fill(0, count($vendorCodes), '?'));
        $rangeStart = sprintf('%04d-01-01', $selectedYear - 1);
        $rangeEnd = sprintf('%04d-01-01', $selectedYear + 1);
        $nextMonth = new DateTimeImmutable('first day of next month');
        $dataEnd = new DateTimeImmutable($rangeEnd);
        if ($dataEnd > $nextMonth) {
            $dataEnd = $nextMonth;
        }
        $dataEndText = $dataEnd->format('Y-m-d');

        $stmt = $pool->prepare(
            "WITH ClientesAsignados AS (
                SELECT DISTINCT LTRIM(RTRIM(CodAux)) AS CodAux
                FROM [PRODIN].[softland].[cwtauxven]
                WHERE LTRIM(RTRIM(VenCod)) IN ($placeholders)
             ),
             PrimeraCompra AS (
                SELECT LTRIM(RTRIM(h.CodAux)) AS CodAux,
                       MIN(CONVERT(date, h.Fecha)) AS FechaPrimera
                FROM [PRODIN].[softland].[iw_gsaen] h
                INNER JOIN ClientesAsignados ca ON ca.CodAux = LTRIM(RTRIM(h.CodAux))
                WHERE h.Tipo IN ('F','N','D')
                  AND h.Estado <> 'A'
                  AND h.Fecha < ?
                GROUP BY LTRIM(RTRIM(h.CodAux))
             ),
             VentasMensuales AS (
                SELECT LTRIM(RTRIM(h.CodAux)) AS CodAux,
                       YEAR(h.Fecha) AS Anio,
                       MONTH(h.Fecha) AS Mes,
                       SUM(m.TotLinea * ($participationExpression)) AS Monto
                FROM [PRODIN].[softland].[iw_gsaen] h
                INNER JOIN [PRODIN].[softland].[iw_gmovi] m
                   ON m.NroInt = h.NroInt AND m.Tipo = h.Tipo
                INNER JOIN ClientesAsignados ca ON ca.CodAux = LTRIM(RTRIM(h.CodAux))
                WHERE h.Tipo = 'F'
                  AND h.Estado <> 'A'
                  AND h.Fecha >= ?
                  AND h.Fecha < ?
                GROUP BY LTRIM(RTRIM(h.CodAux)), YEAR(h.Fecha), MONTH(h.Fecha)
             )
             SELECT YEAR(pc.FechaPrimera) AS Anio,
                    MONTH(pc.FechaPrimera) AS Mes,
                    COUNT(*) AS Cantidad,
                    COALESCE(SUM(vm.Monto), 0) AS Monto
             FROM PrimeraCompra pc
             LEFT JOIN VentasMensuales vm
                ON vm.CodAux = pc.CodAux
               AND vm.Anio = YEAR(pc.FechaPrimera)
               AND vm.Mes = MONTH(pc.FechaPrimera)
             WHERE pc.FechaPrimera >= ?
               AND pc.FechaPrimera < ?
             GROUP BY YEAR(pc.FechaPrimera), MONTH(pc.FechaPrimera)
             ORDER BY Anio, Mes"
        );
        $stmt->execute(array_merge(
            $vendorCodes,
            [$dataEndText],
            $sharedOriginCodes,
            [$rangeStart, $dataEndText, $rangeStart, $rangeEnd]
        ));

        $years = [];
        foreach ($calendar['anios'] as $year) {
            $years[(int)$year['anio']] = $year;
        }
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $year = (int)($row['Anio'] ?? 0);
            $month = (int)($row['Mes'] ?? 0);
            if (!isset($years[$year]) || $month < 1 || $month > 12) {
                continue;
            }
            $quantity = (int)($row['Cantidad'] ?? 0);
            $amount = (int)round((float)($row['Monto'] ?? 0));
            $years[$year]['meses'][$month - 1] = [
                'mes' => $month,
                'cantidad' => $quantity,
                'monto' => $amount,
            ];
            $years[$year]['totalCantidad'] += $quantity;
            $years[$year]['totalMonto'] += $amount;
        }
        $calendar['anios'] = array_values($years);

        return $calendar;
    }

    private function completarCodigosVendedor(int $userId, array $rows): array
    {
        $resultado = [];
        $vistos = [];
        $codeTypeMap = $this->vendorCodeTypeMapFromUserId($userId);
        foreach ($rows as $row) {
            $codigo = trim((string)($row['codVendedor'] ?? ''));
            if ($codigo === '') {
                continue;
            }
            $key = mb_strtoupper($codigo);
            if (isset($vistos[$key])) {
                continue;
            }
            $vistos[$key] = true;
            $resultado[] = $row;
        }

        foreach ($this->getVendorCodes($userId) as $codigo) {
            $codigo = trim((string)$codigo);
            $key = mb_strtoupper($codigo);
            if ($codigo === '' || isset($vistos[$key])) {
                continue;
            }
            $vistos[$key] = true;
            $resultado[] = [
                'codVendedor' => $codigo,
                'nombreVendedor' => $this->getVendorName($codigo),
                'totalFolios' => 0,
                'totalVentasCobrado' => 0,
                'ventaRealLista' => 0,
                'tipoCodigo' => $this->vendorCodeType($codigo, $codeTypeMap),
                'pctDescuento' => 0,
            ];
        }

        usort(
            $resultado,
            static fn(array $a, array $b): int => ((int)($a['esAsignada'] ?? false) <=> (int)($b['esAsignada'] ?? false))
                ?: ((float)($b['totalVentasCobrado'] ?? 0) <=> (float)($a['totalVentasCobrado'] ?? 0))
                ?: strcasecmp((string)($a['codVendedor'] ?? ''), (string)($b['codVendedor'] ?? ''))
        );
        return $resultado;
    }

    private function resolveQuoteVendorField(PDO $pool): string
    {
        if ($this->quoteVendorField !== null) {
            return $this->quoteVendorField;
        }

        $stmt = $pool->prepare(
            "SELECT COLUMN_NAME
             FROM [PRODIN].INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
             ORDER BY ORDINAL_POSITION"
        );
        $stmt->execute(['softland', 'nwcotiza']);
        $candidates = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $column = trim((string)($row['COLUMN_NAME'] ?? ''));
            $normalized = strtolower(preg_replace('/[^a-z0-9]/i', '', $column) ?? '');
            if ($column === '' || !preg_match('/^[a-z0-9_]+$/i', $column)) {
                continue;
            }
            if (!str_contains($normalized, 'vend') && !str_contains($normalized, 'vencod') && !str_contains($normalized, 'codven')) {
                continue;
            }
            $priority = match ($normalized) {
                'codvendedor' => 100,
                'vencod' => 90,
                'codven' => 80,
                default => 10,
            };
            $candidates[] = ['column' => $column, 'priority' => $priority];
        }

        usort($candidates, static fn(array $a, array $b): int => $b['priority'] <=> $a['priority']);
        foreach ($candidates as $candidate) {
            $column = $candidate['column'];
            $quoted = '[' . str_replace(']', ']]', $column) . ']';
            $check = $pool->query(
                "SELECT TOP 1 1
                 FROM [PRODIN].[softland].[nwcotiza] cot
                 INNER JOIN [PRODIN].[softland].[cwtvend] vend
                    ON LTRIM(RTRIM(CONVERT(varchar(50), cot.$quoted))) = LTRIM(RTRIM(vend.VenCod))
                 WHERE cot.$quoted IS NOT NULL"
            );
            if ($check && $check->fetchColumn() !== false) {
                return $this->quoteVendorField = $column;
            }
        }

        if ($candidates) {
            return $this->quoteVendorField = (string)$candidates[0]['column'];
        }

        throw new RuntimeException('No fue posible identificar el campo vendedor de nwcotiza.', 500);
    }

    private function quoteVendorSqlField(PDO $pool): array
    {
        $field = $this->resolveQuoteVendorField($pool);
        return [$field, '[' . str_replace(']', ']]', $field) . ']'];
    }

    private function cotizacionesResumenForUser(int $userId, array $query): array
    {
        $codes = $this->normalizeVendorCodes($this->getVendorCodes($userId));
        $params = $this->monthYear($query);
        if (!$codes) {
            return [
                'total' => ['cantidad' => 0, 'monto' => 0],
                'mes' => ['cantidad' => 0, 'monto' => 0],
                'campoVendedor' => null,
            ];
        }

        $pool = $this->softland();
        [$field, $quotedField] = $this->quoteVendorSqlField($pool);
        $start = new DateTimeImmutable($this->monthStart($params['anio'], $params['mes']));
        $end = $start->modify('+1 month');
        $placeholders = implode(',', array_fill(0, count($codes), '?'));
        $stmt = $pool->prepare(
            "SELECT
                COUNT(*) AS cantidadTotal,
                COALESCE(SUM(CONVERT(decimal(38, 2), cot.ctNetoAfecto)), 0) AS montoTotal,
                SUM(CASE WHEN cot.CtFem >= ? AND cot.CtFem < ? THEN 1 ELSE 0 END) AS cantidadMes,
                COALESCE(SUM(CASE WHEN cot.CtFem >= ? AND cot.CtFem < ? THEN CONVERT(decimal(38, 2), cot.ctNetoAfecto) ELSE 0 END), 0) AS montoMes
             FROM [PRODIN].[softland].[nwcotiza] cot
             WHERE LTRIM(RTRIM(CONVERT(varchar(50), cot.$quotedField))) IN ($placeholders)"
        );
        $stmt->execute(array_merge(
            [$start->format('Y-m-d'), $end->format('Y-m-d'), $start->format('Y-m-d'), $end->format('Y-m-d')],
            $codes
        ));
        $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];

        return [
            'total' => [
                'cantidad' => (int)($row['cantidadTotal'] ?? 0),
                'monto' => (int)round((float)($row['montoTotal'] ?? 0)),
            ],
            'mes' => [
                'cantidad' => (int)($row['cantidadMes'] ?? 0),
                'monto' => (int)round((float)($row['montoMes'] ?? 0)),
            ],
            'campoVendedor' => $field,
        ];
    }

    public function cotizacionesForUser(int $userId, array $query): array
    {
        $mode = (string)($query['modo'] ?? '');
        if (!in_array($mode, ['historico', 'mensual'], true)) {
            throw new RuntimeException('Modo de cotizaciones no valido.', 400);
        }

        $codes = $this->normalizeVendorCodes($this->getVendorCodes($userId));
        if (!$codes) {
            return ['ok' => true, 'modo' => $mode, 'cantidad' => 0, 'monto' => 0, 'items' => [], 'campoVendedor' => null];
        }

        $pool = $this->softland();
        [$field, $quotedField] = $this->quoteVendorSqlField($pool);
        $placeholders = implode(',', array_fill(0, count($codes), '?'));
        $params = $codes;
        $dateSql = '';
        if ($mode === 'mensual') {
            $period = $this->monthYear($query);
            $start = new DateTimeImmutable($this->monthStart($period['anio'], $period['mes']));
            $dateSql = ' AND cot.CtFem >= ? AND cot.CtFem < ?';
            $params[] = $start->format('Y-m-d');
            $params[] = $start->modify('+1 month')->format('Y-m-d');
        }

        $stmt = $pool->prepare(
            "SELECT
                CONVERT(varchar(50), cot.CotNum) AS numero,
                CONVERT(varchar(10), cot.CtFem, 23) AS fecha,
                LTRIM(RTRIM(CONVERT(varchar(50), cot.CodAux))) AS codigoCliente,
                LTRIM(RTRIM(aux.NomAux)) AS cliente,
                CONVERT(decimal(38, 2), cot.ctNetoAfecto) AS monto,
                CONVERT(varchar(100), cot.ctEstado) AS estado,
                LTRIM(RTRIM(CONVERT(varchar(50), cot.$quotedField))) AS codigoVendedor
             FROM [PRODIN].[softland].[nwcotiza] cot
             OUTER APPLY (
                SELECT TOP 1 LTRIM(RTRIM(CONVERT(varchar(max), cliente.NomAux))) AS NomAux
                FROM [PRODIN].[softland].[cwtauxi] cliente
                WHERE LTRIM(RTRIM(cliente.CodAux)) = LTRIM(RTRIM(cot.CodAux))
             ) aux
             WHERE LTRIM(RTRIM(CONVERT(varchar(50), cot.$quotedField))) IN ($placeholders)$dateSql
             ORDER BY cot.CtFem DESC, cot.CotNum DESC"
        );
        $stmt->execute($params);
        $items = array_map(static fn(array $row): array => [
            'numero' => trim((string)($row['numero'] ?? '')),
            'fecha' => substr((string)($row['fecha'] ?? ''), 0, 10),
            'codigoCliente' => trim((string)($row['codigoCliente'] ?? '')),
            'cliente' => trim((string)($row['cliente'] ?? '')),
            'monto' => (int)round((float)($row['monto'] ?? 0)),
            'estado' => trim((string)($row['estado'] ?? '')),
            'codigoVendedor' => trim((string)($row['codigoVendedor'] ?? '')),
        ], $stmt->fetchAll(PDO::FETCH_ASSOC));

        return [
            'ok' => true,
            'modo' => $mode,
            'cantidad' => count($items),
            'monto' => (int)array_sum(array_column($items, 'monto')),
            'items' => $items,
            'campoVendedor' => $field,
        ];
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

    private function fetchSharedMonthRows(array $vendCodes, int $mes, int $anio): array
    {
        $codes = $this->normalizeVendorCodes($vendCodes);
        if (!$codes) {
            return [];
        }

        $selected = [];
        foreach ($codes as $code) {
            $selected[$this->sharedCodeKey($code)] = true;
        }
        $rows = array_values(array_filter(
            $this->fetchSharedAssignments($codes, $mes, $anio),
            fn(array $row): bool => isset($selected[$this->sharedCodeKey($row['codVendedorDestino'] ?? '')])
        ));

        return array_map(static function (array $row): array {
            $monto = (float)($row['monto_asignado'] ?? 0);
            $montoReal = (float)($row['monto_real_asignado'] ?? $monto);
            $porcentaje = (float)($row['porcentaje'] ?? 0);
            return [
                'Folio' => (int)($row['folio'] ?? 0),
                'fecha_formato' => substr((string)($row['fecha'] ?? ''), 0, 10),
                'cliente' => trim((string)($row['cliente'] ?? '')),
                'CodAux' => '',
                'CodVendedor' => trim((string)($row['codVendedorDestino'] ?? '')),
                'Tipo' => strtoupper(trim((string)($row['tipoDocumento'] ?? 'F'))),
                'monto' => (int)round($monto),
                'venta_real_folio' => (int)round($montoReal),
                'venta_lista_folio' => (int)round($montoReal),
                'TotLineaReal' => (int)round($montoReal),
                'pct_descuento' => $montoReal != 0.0 ? round((1 - ($monto / $montoReal)) * 100, 2) : 0,
                'es_compartido' => true,
                'monto_asignado' => (int)round($monto),
                'porcentaje_asignado' => $porcentaje,
            ];
        }, $rows);
    }

    private function sharedCodeKey(mixed $value): string
    {
        $code = mb_strtoupper(trim((string)$value));
        if ($code !== '' && preg_match('/^\d+$/', $code)) {
            return ltrim($code, '0') ?: '0';
        }
        return $code;
    }

    private function sharedFolioKey(mixed $value): string
    {
        $folio = trim((string)$value);
        if ($folio !== '' && preg_match('/^\d+$/', $folio)) {
            return ltrim($folio, '0') ?: '0';
        }
        return mb_strtoupper($folio);
    }

    private function fetchSharedAssignments(array $vendCodes, int $mes, int $anio): array
    {
        $codes = $this->normalizeVendorCodes($vendCodes);
        if (!$codes) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($codes), '?'));
        $assignments = $this->db->fetchAll(
            "SELECT
                fc.id,
                fc.folio,
                fc.fecha,
                fc.cliente,
                fc.monto_neto,
                fc.monto_asignado,
                fc.porcentaje,
                TRIM(fc.cod_vendedor_principal) AS codVendedorOrigen,
                TRIM(fc.cod_vendedor_compartido) AS codVendedorDestino
             FROM factura_compartida fc
             WHERE (TRIM(fc.cod_vendedor_principal) IN ($placeholders)
                    OR TRIM(fc.cod_vendedor_compartido) IN ($placeholders))
               AND fc.mes = ?
               AND fc.anio = ?
               AND fc.rol = 'compartido'
             ORDER BY fc.fecha DESC, fc.folio DESC, fc.id DESC",
            array_merge($codes, $codes, [$mes, $anio])
        );
        if (!$assignments) {
            return [];
        }

        $folios = [];
        $origins = [];
        foreach ($assignments as $assignment) {
            $folio = trim((string)($assignment['folio'] ?? ''));
            $origin = trim((string)($assignment['codVendedorOrigen'] ?? ''));
            if ($folio !== '') {
                $folios[$folio] = true;
            }
            foreach ($this->normalizeVendorCodes([$origin]) as $code) {
                $origins[$code] = true;
            }
        }
        if (!$folios || !$origins) {
            return $assignments;
        }

        $folioValues = array_keys($folios);
        $originValues = array_keys($origins);
        $folioPlaceholders = implode(',', array_fill(0, count($folioValues), '?'));
        $originPlaceholders = implode(',', array_fill(0, count($originValues), '?'));
        $start = $this->monthStart($anio, $mes);
        $saleExpression = $this->commercialAmountSql('h.Tipo', 'm.TotLinea');
        $realExpression = $this->commercialAmountSql('h.Tipo', 'm.CantFacturada * ISNULL(t.PrecioVta, 0)');
        $stmt = $this->softland()->prepare(
            "SELECT
                LTRIM(RTRIM(h.CodVendedor)) AS codigoOrigen,
                CONVERT(varchar(50), h.Folio) AS folio,
                MIN(h.Tipo) AS tipoDocumento,
                SUM(CONVERT(decimal(38, 6), $saleExpression)) AS ventaDocumento,
                SUM(CONVERT(decimal(38, 6), $realExpression)) AS ventaRealDocumento
             FROM [PRODIN].[softland].[iw_gsaen] h
             INNER JOIN [PRODIN].[softland].[iw_gmovi] m
                ON m.NroInt = h.NroInt AND m.Tipo = h.Tipo
             INNER JOIN [PRODIN].[softland].[iw_tprod] t
                ON t.CodProd = m.CodProd
             WHERE h.Tipo IN ('F', 'N', 'D')
               AND h.Estado <> 'A'
               AND h.Fecha >= ?
               AND h.Fecha < DATEADD(MONTH, 1, ?)
               AND h.Folio IN ($folioPlaceholders)
               AND LTRIM(RTRIM(h.CodVendedor)) IN ($originPlaceholders)
             GROUP BY LTRIM(RTRIM(h.CodVendedor)), h.Folio"
        );
        $stmt->execute(array_merge([$start, $start], $folioValues, $originValues));
        $documents = [];
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $key = $this->sharedCodeKey($row['codigoOrigen'] ?? '') . '|' . $this->sharedFolioKey($row['folio'] ?? '');
            $documents[$key] = [
                'tipo' => strtoupper(trim((string)($row['tipoDocumento'] ?? ''))),
                'venta' => (float)($row['ventaDocumento'] ?? 0),
                'ventaReal' => (float)($row['ventaRealDocumento'] ?? 0),
            ];
        }

        foreach ($assignments as &$assignment) {
            $key = $this->sharedCodeKey($assignment['codVendedorOrigen'] ?? '') . '|' . $this->sharedFolioKey($assignment['folio'] ?? '');
            $document = $documents[$key] ?? null;
            if ($document === null) {
                $assignment['monto_real_asignado'] = (float)($assignment['monto_asignado'] ?? 0);
                continue;
            }
            $percentage = max(0.0, min(100.0, (float)($assignment['porcentaje'] ?? 0))) / 100;
            $assignment['monto_neto'] = $document['venta'];
            $assignment['monto_asignado'] = $document['venta'] * $percentage;
            $assignment['tipoDocumento'] = $document['tipo'];
            $assignment['monto_real_documento'] = $document['ventaReal'];
            $assignment['monto_real_asignado'] = $document['ventaReal'] * $percentage;
        }
        unset($assignment);

        return $assignments;
    }

    private function sharedProductCategories(array $assignments, int $mes, int $anio): array
    {
        $folios = [];
        $originCodes = [];
        foreach ($assignments as $assignment) {
            $folio = trim((string)($assignment['folio'] ?? ''));
            $origin = trim((string)($assignment['codVendedorOrigen'] ?? ''));
            if ($folio === '' || $origin === '') {
                continue;
            }
            $folios[$folio] = true;
            foreach ($this->normalizeVendorCodes([$origin]) as $code) {
                $originCodes[$code] = true;
            }
        }
        if (!$folios || !$originCodes) {
            return [];
        }

        $folioValues = array_keys($folios);
        $codeValues = array_keys($originCodes);
        $folioPlaceholders = implode(',', array_fill(0, count($folioValues), '?'));
        $codePlaceholders = implode(',', array_fill(0, count($codeValues), '?'));
        $start = $this->monthStart($anio, $mes);
        $saleExpression = $this->commercialAmountSql('h.Tipo', 'm.TotLinea');
        $stmt = $this->softland()->prepare(
            "SELECT
                LTRIM(RTRIM(h.CodVendedor)) AS codVendedorOrigen,
                CONVERT(varchar(50), h.Folio) AS folio,
                LTRIM(RTRIM(COALESCE(t.CtaVentas, ''))) AS cuentaCategoria,
                SUM(CONVERT(decimal(38, 6), $saleExpression)) AS ventaProducto
             FROM [PRODIN].[softland].[iw_gsaen] h
             INNER JOIN [PRODIN].[softland].[iw_gmovi] m
                ON m.NroInt = h.NroInt AND m.Tipo = h.Tipo
             INNER JOIN [PRODIN].[softland].[iw_tprod] t
                ON t.CodProd = m.CodProd
             WHERE h.Tipo IN ('F', 'N', 'D')
               AND h.Estado <> 'A'
               AND h.Fecha >= ?
               AND h.Fecha < DATEADD(MONTH, 1, ?)
               AND h.Folio IN ($folioPlaceholders)
               AND LTRIM(RTRIM(h.CodVendedor)) IN ($codePlaceholders)
             GROUP BY h.CodVendedor, h.Folio, t.CtaVentas",
        );
        $stmt->execute(array_merge([$start, $start], $folioValues, $codeValues));

        $products = [];
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $key = $this->sharedCodeKey($row['codVendedorOrigen'] ?? '') . '|' . $this->sharedFolioKey($row['folio'] ?? '');
            $account = trim((string)($row['cuentaCategoria'] ?? ''));
            $products[$key][$account] = ($products[$key][$account] ?? 0.0) + (float)($row['ventaProducto'] ?? 0);
        }
        return $products;
    }

    private function roundedCategoryRows(array $grouped, float $expectedTotal): array
    {
        $rounded = [];
        $remainders = [];
        foreach ($grouped as $category => $amount) {
            if (abs((float)$amount) < 0.000001) {
                continue;
            }
            $integer = (int)round((float)$amount);
            $rounded[$category] = $integer;
            $remainders[$category] = (float)$amount - $integer;
        }

        $difference = (int)round($expectedTotal) - array_sum($rounded);
        if ($difference !== 0 && $rounded) {
            $direction = $difference > 0 ? 1 : -1;
            uasort($remainders, static fn(float $a, float $b): int => $direction > 0 ? ($b <=> $a) : ($a <=> $b));
            $categories = array_keys($remainders);
            for ($index = 0; $difference !== 0; $index++) {
                $category = $categories[$index % count($categories)];
                $rounded[$category] += $direction;
                $difference -= $direction;
            }
        }

        $rows = [];
        $total = (int)round($expectedTotal);
        foreach ($rounded as $category => $amount) {
            $rows[] = [
                'categoria' => $category,
                'total' => $amount,
                'participacion' => $total > 0 ? round(($amount / $total) * 100, 2) : 0,
            ];
        }
        usort($rows, static fn(array $a, array $b): int => $b['total'] <=> $a['total']);
        return $rows;
    }

    private function sharedCategoryDistribution(
        array $vendCodes,
        int $mes,
        int $anio,
        array $assignments,
        array $productCategories,
        array $codeTypeMap = []
    ): array
    {
        $codes = $this->normalizeVendorCodes($vendCodes);
        if (!$codes) {
            return [];
        }

        $categoryRows = $this->db->fetchAll('SELECT Cta, Categoria FROM categoriasproducto');
        $categoryMap = [];
        foreach ($categoryRows as $row) {
            $account = trim((string)($row['Cta'] ?? ''));
            if ($account !== '') {
                $categoryMap[$account] = trim((string)($row['Categoria'] ?? '')) ?: 'Otros';
            }
        }

        $placeholders = implode(',', array_fill(0, count($codes), '?'));
        $start = $this->monthStart($anio, $mes);
        $saleExpression = $this->commercialAmountSql('h.Tipo', 'm.TotLinea');
        $stmt = $this->softland()->prepare(
            "SELECT
                LTRIM(RTRIM(h.CodVendedor)) AS codigoVendedor,
                LTRIM(RTRIM(COALESCE(t.CtaVentas, ''))) AS cuentaCategoria,
                SUM(CONVERT(decimal(38, 6), $saleExpression)) AS total
             FROM [PRODIN].[softland].[iw_gsaen] h
             INNER JOIN [PRODIN].[softland].[iw_gmovi] m
                ON m.NroInt = h.NroInt AND m.Tipo = h.Tipo
             INNER JOIN [PRODIN].[softland].[iw_tprod] t
                ON t.CodProd = m.CodProd
             WHERE LTRIM(RTRIM(h.CodVendedor)) IN ($placeholders)
               AND h.Tipo IN ('F', 'N', 'D')
               AND h.Estado <> 'A'
               AND h.Fecha >= ?
               AND h.Fecha < DATEADD(MONTH, 1, ?)
             GROUP BY h.CodVendedor, t.CtaVentas"
        );
        $stmt->execute(array_merge($codes, [$start, $start]));

        $grouped = [];
        $ownTotal = 0.0;
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $account = trim((string)($row['cuentaCategoria'] ?? ''));
            $category = $categoryMap[$account] ?? ($account !== '' ? $account : 'Otros');
            $type = $this->vendorCodeType($row['codigoVendedor'] ?? '', $codeTypeMap);
            $amount = (float)($row['total'] ?? 0) * $this->vendorCodeParticipationFactor($type);
            $grouped[$category] = ($grouped[$category] ?? 0.0) + $amount;
            $ownTotal += $amount;
        }

        $selected = [];
        foreach ($codes as $code) {
            $selected[$this->sharedCodeKey($code)] = true;
        }
        $sharedDelta = 0.0;
        foreach ($assignments as $assignment) {
            $originKey = $this->sharedCodeKey($assignment['codVendedorOrigen'] ?? '');
            $destinationKey = $this->sharedCodeKey($assignment['codVendedorDestino'] ?? '');
            $amount = (float)($assignment['monto_asignado'] ?? 0);
            $originType = $this->vendorCodeType($assignment['codVendedorOrigen'] ?? '', $codeTypeMap);
            $outgoing = $this->sharedOutgoingAmount($amount, $originType);
            $delta = (isset($selected[$destinationKey]) ? $amount : 0.0)
                - (isset($selected[$originKey]) ? $outgoing : 0.0);
            if (abs($delta) < 0.000001) {
                continue;
            }

            $sharedDelta += $delta;
            $documentKey = $originKey . '|' . $this->sharedFolioKey($assignment['folio'] ?? '');
            $accounts = $productCategories[$documentKey] ?? [];
            $documentTotal = array_sum($accounts);
            if (!$accounts || abs($documentTotal) < 0.000001) {
                $grouped['Otros'] = ($grouped['Otros'] ?? 0.0) + $delta;
                continue;
            }

            foreach ($accounts as $account => $lineAmount) {
                $category = $categoryMap[trim((string)$account)] ?? (trim((string)$account) !== '' ? trim((string)$account) : 'Otros');
                $grouped[$category] = ($grouped[$category] ?? 0.0) + ($delta * ((float)$lineAmount / $documentTotal));
            }
        }

        return $this->roundedCategoryRows($grouped, $ownTotal + $sharedDelta);
    }

    private function sharedSalesOriginSummary(array $vendCodes, array $assignments, array $productCategories): array
    {
        $selected = [];
        foreach ($this->normalizeVendorCodes($vendCodes) as $code) {
            $selected[$this->sharedCodeKey($code)] = true;
        }

        $grouped = [];
        foreach ($assignments as $assignment) {
            $destinationKey = $this->sharedCodeKey($assignment['codVendedorDestino'] ?? '');
            if (!isset($selected[$destinationKey])) {
                continue;
            }
            $origin = trim((string)($assignment['codVendedorOrigen'] ?? ''));
            $originKey = $this->sharedCodeKey($origin);
            $folioKey = $this->sharedFolioKey($assignment['folio'] ?? '');
            $assignedAmount = (float)($assignment['monto_asignado'] ?? 0);
            $grouped[$originKey]['codigo'] = $origin;
            $grouped[$originKey]['ventaCompartida'] = ($grouped[$originKey]['ventaCompartida'] ?? 0.0) + $assignedAmount;
            $grouped[$originKey]['folios'][$folioKey] = true;
            $realAmount = (float)($assignment['monto_real_asignado'] ?? $assignment['monto_asignado'] ?? 0);
            $grouped[$originKey]['ventaReal'] = ($grouped[$originKey]['ventaReal'] ?? 0.0) + $realAmount;
        }

        $total = array_reduce($grouped, static fn(float $sum, array $row): float => $sum + (float)($row['ventaCompartida'] ?? 0), 0.0);
        $totalReal = array_reduce($grouped, static fn(float $sum, array $row): float => $sum + (float)($row['ventaReal'] ?? 0), 0.0);
        $items = [];
        foreach ($grouped as $row) {
            $amount = (float)($row['ventaCompartida'] ?? 0);
            $code = (string)($row['codigo'] ?? '');
            $items[] = [
                'vendedorOrigen' => $this->getVendorName($code),
                'codigo' => $code,
                'folios' => count($row['folios'] ?? []),
                'ventaCompartida' => (int)round($amount),
                'ventaReal' => (int)round((float)($row['ventaReal'] ?? 0)),
                'participacion' => $total > 0 ? round(($amount / $total) * 100, 2) : 0,
            ];
        }
        usort($items, static fn(array $a, array $b): int => $b['ventaCompartida'] <=> $a['ventaCompartida']);

        return [
            'items' => $items,
            'totalVentaCompartida' => (int)round($total),
            'totalVentaReal' => (int)round($totalReal),
        ];
    }

    private function fetchSharedVendorBalances(array $vendCodes, int $mes, int $anio): array
    {
        $codes = $this->normalizeVendorCodes($vendCodes);
        if (!$codes) {
            return [];
        }
        $balances = [];

        $selected = [];
        foreach ($codes as $code) {
            $selected[$this->sharedCodeKey($code)] = true;
        }
        foreach ($this->fetchSharedAssignments($codes, $mes, $anio) as $assignment) {
            $saleAmount = (float)($assignment['monto_asignado'] ?? 0);
            $realAmount = (float)($assignment['monto_real_asignado'] ?? $saleAmount);
            $folioKey = $this->sharedFolioKey($assignment['folio'] ?? '');
            foreach ([
                ['direction' => 'outgoing', 'code' => $assignment['codVendedorOrigen'] ?? ''],
                ['direction' => 'incoming', 'code' => $assignment['codVendedorDestino'] ?? ''],
            ] as $side) {
                $code = trim((string)$side['code']);
                $key = $this->sharedCodeKey($code);
                if ($code === '' || !isset($selected[$key])) {
                    continue;
                }
                $direction = $side['direction'];
                $balances[$key]['codigo'] = $code;
                $balances[$key][$direction] = ($balances[$key][$direction] ?? 0.0) + $saleAmount;
                $balances[$key][$direction . '_real'] = ($balances[$key][$direction . '_real'] ?? 0.0) + $realAmount;
                $balances[$key][$direction . '_folios'][$folioKey] = true;
            }
        }
        foreach ($balances as &$balance) {
            $balance['outgoing_folios'] = count($balance['outgoing_folios'] ?? []);
            $balance['incoming_folios'] = count($balance['incoming_folios'] ?? []);
        }
        unset($balance);

        return $balances;
    }

    private function fetchSharedMonthlyBalances(array $vendCodes, int $anio, array $codeTypeMap = []): array
    {
        $codes = $this->normalizeVendorCodes($vendCodes);
        if (!$codes) {
            return [];
        }

        $balances = [];
        foreach (range(1, 12) as $mes) {
            $monthBalance = 0.0;
            foreach ($this->fetchSharedVendorBalances($codes, $mes, $anio) as $balance) {
                $type = $this->vendorCodeType($balance['codigo'] ?? '', $codeTypeMap);
                $monthBalance += (float)($balance['incoming'] ?? 0)
                    - $this->sharedOutgoingAmount($balance['outgoing'] ?? 0, $type);
            }
            $balances[$mes] = $monthBalance;
        }

        return $balances;
    }

    public function applySharedSalesToVendorRows(
        array $rows,
        int $mes,
        int $anio,
        array $extraCodes = [],
        array $codeTypeMap = []
    ): array
    {
        $byCode = [];
        foreach ($rows as $row) {
            $code = trim((string)($row['codigoVendedor'] ?? ''));
            if ($code === '') {
                continue;
            }
            $key = $this->sharedCodeKey($code);
            $type = $this->vendorCodeType($code, $codeTypeMap);
            $factor = $this->vendorCodeParticipationFactor($type);
            $byCode[$key] = [
                'codigoVendedor' => $code,
                'nombreVendedor' => trim((string)($row['nombreVendedor'] ?? $row['descripcion'] ?? '')) ?: $code,
                'venta' => (float)($row['venta'] ?? $row['neto'] ?? 0) * $factor,
                'ventaReal' => (float)($row['ventaReal'] ?? 0) * $factor,
                'ventaBaseAtribuida' => (float)($row['venta'] ?? $row['neto'] ?? 0) * $factor,
                'ventaRealBaseAtribuida' => (float)($row['ventaReal'] ?? 0) * $factor,
                'ventaCompartidaRecibida' => 0.0,
                'ventaRealCompartidaRecibida' => 0.0,
                'ventaCompartidaEntregada' => 0.0,
                'ventaRealCompartidaEntregada' => 0.0,
                'tipoCodigo' => $type,
            ];
        }
        $codes = array_values(array_unique(array_merge(
            array_column($byCode, 'codigoVendedor'),
            array_map(static fn(mixed $code): string => trim((string)$code), $extraCodes)
        )));
        foreach ($this->fetchSharedVendorBalances($codes, $mes, $anio) as $key => $balance) {
            $code = trim((string)($balance['codigo'] ?? $key));
            if (!isset($byCode[$key])) {
                $byCode[$key] = [
                    'codigoVendedor' => $code,
                    'nombreVendedor' => $code,
                    'venta' => 0.0,
                    'ventaReal' => 0.0,
                    'ventaBaseAtribuida' => 0.0,
                    'ventaRealBaseAtribuida' => 0.0,
                    'ventaCompartidaRecibida' => 0.0,
                    'ventaRealCompartidaRecibida' => 0.0,
                    'ventaCompartidaEntregada' => 0.0,
                    'ventaRealCompartidaEntregada' => 0.0,
                    'tipoCodigo' => $this->vendorCodeType($code, $codeTypeMap),
                ];
            }
            $type = $byCode[$key]['tipoCodigo'] ?? '';
            $incoming = (float)($balance['incoming'] ?? 0);
            $incomingReal = (float)($balance['incoming_real'] ?? $balance['incoming'] ?? 0);
            $outgoing = $this->sharedOutgoingAmount($balance['outgoing'] ?? 0, $type);
            $outgoingReal = $this->sharedOutgoingAmount(
                $balance['outgoing_real'] ?? $balance['outgoing'] ?? 0,
                $type
            );
            $byCode[$key]['ventaCompartidaRecibida'] += $incoming;
            $byCode[$key]['ventaRealCompartidaRecibida'] += $incomingReal;
            $byCode[$key]['ventaCompartidaEntregada'] += $outgoing;
            $byCode[$key]['ventaRealCompartidaEntregada'] += $outgoingReal;
            $byCode[$key]['venta'] += $incoming - $outgoing;
            $byCode[$key]['ventaReal'] += $incomingReal - $outgoingReal;
        }

        return array_values($byCode);
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
        $saleExpression = $this->commercialAmountSql('enc.Tipo', 'm.TotLinea');
        $realExpression = $this->commercialAmountSql('enc.Tipo', 'm.CantFacturada * ISNULL(t.PrecioVta, 0)');
        $sql = sprintf(
            "SELECT LTRIM(RTRIM(enc.CodVendedor)) AS codigoVendedor,
                    SUM(%s) AS venta,
                    SUM(%s) AS ventaReal
             FROM [PRODIN].[softland].[iw_gsaen] enc
             INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = enc.NroInt AND m.Tipo = enc.Tipo
             INNER JOIN [PRODIN].[softland].[iw_tprod] t ON t.CodProd = m.CodProd

             WHERE enc.Tipo IN ('F', 'N', 'D')
               AND enc.Estado <> 'A'
               AND enc.CodVendedor IN (%s)
               AND MONTH(enc.Fecha) = ? AND YEAR(enc.Fecha) = ?
             GROUP BY LTRIM(RTRIM(enc.CodVendedor))",
            $saleExpression,
            $realExpression,
             WHERE %s
               AND enc.Estado <> 'A'
               AND enc.CodVendedor IN (%s)
               AND MONTH(enc.Fecha) = ? AND YEAR(enc.Fecha) = ?",
            $this->softlandVentaTiposSql('enc'), release/v1.0
            implode(',', array_fill(0, count($vendCodes), '?'))
        );
        $stmt = $pool->prepare($sql);
        $stmt->execute(array_merge($vendCodes, [$mes, $anio]));
        $rows = $this->applySharedSalesToVendorRows(
            $stmt->fetchAll(PDO::FETCH_ASSOC),
            $mes,
            $anio,
            $vendCodes,
            $this->vendorCodeTypeMapFromUserId($userId)
        );
        $ventas = array_sum(array_column($rows, 'venta'));
        $lista = array_sum(array_column($rows, 'ventaReal'));

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
        $saleExpression = $this->commercialAmountSql('enc.Tipo', 'm.TotLinea');
        $sql = sprintf(
            "SELECT MONTH(enc.Fecha) AS mes,
                    LTRIM(RTRIM(enc.CodVendedor)) AS codigoVendedor,
                    SUM(%s) AS venta
             FROM [PRODIN].[softland].[iw_gsaen] enc
             INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = enc.NroInt AND m.Tipo = enc.Tipo
             WHERE %s
               AND enc.CodVendedor IN (%s)
               AND YEAR(enc.Fecha) = ?
               AND enc.Tipo IN ('F', 'N', 'D')
               AND enc.Estado <> 'A'
             GROUP BY MONTH(enc.Fecha), LTRIM(RTRIM(enc.CodVendedor))
             ORDER BY mes, codigoVendedor",
            $saleExpression,
            implode(',', array_fill(0, count($vendCodes), '?'))
        );
        $stmt = $pool->prepare($sql);
        $stmt->execute(array_merge($vendCodes, [$anio]));
        $rowsByMonth = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $rowMonth = (int)($row['mes'] ?? 0);
            if ($rowMonth >= 1 && $rowMonth <= 12) {
                $rowsByMonth[$rowMonth][] = $row;
            }
        }

        $codeTypeMap = $this->vendorCodeTypeMapFromUserId($userId);
        foreach (range(1, 12) as $month) {
            $weightedRows = $this->applySharedSalesToVendorRows(
                $rowsByMonth[$month] ?? [],
                $month,
                $anio,
                $vendCodes,
                $codeTypeMap
            );
            $evolucion[$month - 1]['ventas'] = (int)round(array_sum(array_column($weightedRows, 'venta')));
        }

        return ['ok' => true, 'evolucion' => $evolucion];
    }

    public function vendedores(array $payload, array $query, bool $separarAsignadas = false): array
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
        $saleExpression = $this->commercialAmountSql('enc.Tipo', 'm.TotLinea');
        $realExpression = $this->commercialAmountSql('enc.Tipo', 'm.CantFacturada * ISNULL(t.PrecioVta, 0)');
        $sql = sprintf(
            "SELECT
                LTRIM(RTRIM(enc.CodVendedor)) AS codVendedor,
                MIN(enc.NomAux) AS nombreVendedor,
                COUNT(DISTINCT enc.Folio) AS totalFolios,
                SUM(%s) AS totalVentasCobrado,
                SUM(%s) AS ventaRealLista
             FROM [PRODIN].[softland].[iw_gsaen] enc
             INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = enc.NroInt AND m.Tipo = enc.Tipo
             INNER JOIN [PRODIN].[softland].[iw_tprod] t ON t.CodProd = m.CodProd
             WHERE enc.CodVendedor IN (%s)
               AND enc.Tipo IN ('F', 'N', 'D')
               AND enc.Estado <> 'A'
               AND MONTH(enc.Fecha) = ? AND YEAR(enc.Fecha) = ?
             GROUP BY LTRIM(RTRIM(enc.CodVendedor))
             ORDER BY totalVentasCobrado DESC",
            $saleExpression,
            $realExpression,
            implode(',', array_fill(0, count($vendCodes), '?'))
        );
        $stmt = $pool->prepare($sql);
        $stmt->execute(array_merge($vendCodes, [$mes, $anio]));
        $rows = [];
        $codeTypeMap = $this->vendorCodeTypeMapFromUserId($userId);
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $codigo = trim((string)$row['codVendedor']);
            $type = $this->vendorCodeType($codigo, $codeTypeMap);
            $factor = $this->vendorCodeParticipationFactor($type);
            $ventas = (float)($row['totalVentasCobrado'] ?? 0) * $factor;
            $lista = (float)($row['ventaRealLista'] ?? 0) * $factor;
            $rows[] = [
                'codVendedor' => $codigo,
                'nombreVendedor' => $this->getVendorName($codigo),
                'totalFolios' => (int)($row['totalFolios'] ?? 0),
                'totalVentasCobrado' => $ventas,
                'ventaRealLista' => $lista,
                'tipoCodigo' => $type,
                'pctDescuento' => $lista > 0 ? round((1 - ($ventas / $lista)) * 100, 2) : 0,
            ];
        }

        $balances = $this->fetchSharedVendorBalances($vendCodes, $mes, $anio);
        $ventasAsignadas = 0.0;
        $ventaRealAsignada = 0.0;
        $foliosAsignados = 0;
        foreach ($rows as &$row) {
            $codigo = trim((string)($row['codVendedor'] ?? ''));
            $balanceKey = $this->sharedCodeKey($codigo);
            if ($codigo === '' || !isset($balances[$balanceKey])) {
                continue;
            }

            $balance = $balances[$balanceKey];
            $incoming = (float)($balance['incoming'] ?? 0);
            $incomingReal = (float)($balance['incoming_real'] ?? $incoming);
            $incomingFolios = (int)($balance['incoming_folios'] ?? 0);
            $type = $row['tipoCodigo'] ?? '';
            $outgoing = $this->sharedOutgoingAmount($balance['outgoing'] ?? 0, $type);
            $outgoingReal = $this->sharedOutgoingAmount(
                $balance['outgoing_real'] ?? $balance['outgoing'] ?? 0,
                $type
            );
            $outgoingFolios = (int)$this->sharedOutgoingAmount($balance['outgoing_folios'] ?? 0, $type);
            $ajuste = ($separarAsignadas ? 0.0 : $incoming) - $outgoing;
            $ajusteReal = ($separarAsignadas ? 0.0 : $incomingReal) - $outgoingReal;
            $ajusteFolios = ($separarAsignadas ? 0 : $incomingFolios) - $outgoingFolios;
            $ventasAsignadas += $incoming;
            $ventaRealAsignada += $incomingReal;
            $foliosAsignados += $incomingFolios;

            $row['totalVentasCobrado'] = (float)($row['totalVentasCobrado'] ?? 0) + $ajuste;
            $row['ventaRealLista'] = (float)($row['ventaRealLista'] ?? 0) + $ajusteReal;
            $ventasAjustadas = (float)($row['totalVentasCobrado'] ?? 0);
            $listaAjustada = (float)($row['ventaRealLista'] ?? 0);
            $row['pctDescuento'] = $listaAjustada > 0 ? round((1 - ($ventasAjustadas / $listaAjustada)) * 100, 2) : 0;

            unset($balances[$balanceKey]);
        }
        unset($row);

        foreach ($balances as $codigo => $balance) {
            $codigo = trim((string)($balance['codigo'] ?? $codigo));
            $incoming = (float)($balance['incoming'] ?? 0);
            $incomingReal = (float)($balance['incoming_real'] ?? $incoming);
            $incomingFolios = (int)($balance['incoming_folios'] ?? 0);
            $type = $this->vendorCodeType($codigo, $codeTypeMap);
            $outgoing = $this->sharedOutgoingAmount($balance['outgoing'] ?? 0, $type);
            $outgoingReal = $this->sharedOutgoingAmount(
                $balance['outgoing_real'] ?? $balance['outgoing'] ?? 0,
                $type
            );
            $outgoingFolios = (int)$this->sharedOutgoingAmount($balance['outgoing_folios'] ?? 0, $type);
            $ajuste = ($separarAsignadas ? 0.0 : $incoming) - $outgoing;
            $ajusteReal = ($separarAsignadas ? 0.0 : $incomingReal) - $outgoingReal;
            $ajusteFolios = ($separarAsignadas ? 0 : $incomingFolios) - $outgoingFolios;
            $ventasAsignadas += $incoming;
            $ventaRealAsignada += $incomingReal;
            $foliosAsignados += $incomingFolios;
            $ventas = $ajuste;
            $lista = $ajusteReal;
            $rows[] = [
                'codVendedor' => $codigo,
                'nombreVendedor' => $this->getVendorName($codigo),
                'totalFolios' => 0,
                'totalVentasCobrado' => $ventas,
                'ventaRealLista' => $lista,
                'tipoCodigo' => $type,
                'pctDescuento' => $lista > 0 ? round((1 - ($ventas / $lista)) * 100, 2) : 0,
            ];
        }

        if ($separarAsignadas && ($ventasAsignadas !== 0.0 || $foliosAsignados !== 0)) {
            $rows[] = [
                'codVendedor' => 'VENTAS COMPARTIDAS TA',
                'nombreVendedor' => 'Ventas Compartidas TA',
                'totalFolios' => $foliosAsignados,
                'totalVentasCobrado' => $ventasAsignadas,
                'ventaRealLista' => $ventaRealAsignada,
                'pctDescuento' => $ventaRealAsignada > 0 ? round((1 - ($ventasAsignadas / $ventaRealAsignada)) * 100, 2) : 0,
                'esAsignada' => true,
            ];
        }

        usort(
            $rows,
            static fn(array $a, array $b): int => ((int)($a['esAsignada'] ?? false) <=> (int)($b['esAsignada'] ?? false))
                ?: ($b['totalVentasCobrado'] <=> $a['totalVentasCobrado'])
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
        $codes = array_values(array_unique(array_filter(array_map(
            static fn(mixed $code): string => trim((string)$code),
            $this->vendorCodes($payload)
        ))));
        if (!$codes) {
            return [
                'ok' => true,
                'ventasCompartidasRecibidas' => [],
                'totales' => ['folios' => 0, 'monto' => 0],
            ];
        }

        $periodo = $this->monthYear($query);
        $selected = array_fill_keys(array_map([$this, 'sharedCodeKey'], $codes), true);
        $grouped = [];
        foreach ($this->fetchSharedAssignments($codes, $periodo['mes'], $periodo['anio']) as $assignment) {
            $destinationKey = $this->sharedCodeKey($assignment['codVendedorDestino'] ?? '');
            if (!isset($selected[$destinationKey])) {
                continue;
            }
            $origin = trim((string)($assignment['codVendedorOrigen'] ?? ''));
            $originKey = $this->sharedCodeKey($origin);
            $folioKey = $this->sharedFolioKey($assignment['folio'] ?? '');
            $grouped[$originKey]['CodigoAsignador'] = $origin;
            $grouped[$originKey]['NombreAsignador'] = $this->getVendorName($origin);
            $grouped[$originKey]['folios'][$folioKey] = true;
            $grouped[$originKey]['MontoAsignado'] = ($grouped[$originKey]['MontoAsignado'] ?? 0.0)
                + (float)($assignment['monto_asignado'] ?? 0);
        }

        $rows = array_values(array_map(static fn(array $row): array => [
            'CodigoAsignador' => (string)($row['CodigoAsignador'] ?? ''),
            'NombreAsignador' => (string)($row['NombreAsignador'] ?? ''),
            'FoliosAsignados' => count($row['folios'] ?? []),
            'MontoAsignado' => (float)($row['MontoAsignado'] ?? 0),
        ], $grouped));
        usort($rows, static fn(array $a, array $b): int => ($b['MontoAsignado'] <=> $a['MontoAsignado'])
            ?: strcmp($a['CodigoAsignador'], $b['CodigoAsignador']));

        return [
            'ok' => true,
            'ventasCompartidasRecibidas' => $rows,
            'totales' => [
                'folios' => array_sum(array_column($rows, 'FoliosAsignados')),
                'monto' => array_sum(array_column($rows, 'MontoAsignado')),
            ],
        ];
    }

    public function ventasCompartidasEntregadasResumen(array $payload, array $query): array
    {
        $codes = $this->normalizeVendorCodes($this->coordinatorCodes($payload));
        if (!$codes) {
            return [
                'ok' => true,
                'ventasCompartidasEntregadas' => [],
                'totales' => ['folios' => 0, 'monto' => 0],
            ];
        }

        $periodo = $this->monthYear($query);
        $selected = array_fill_keys(array_map([$this, 'sharedCodeKey'], $codes), true);
        $rows = [];
        foreach ($this->fetchSharedAssignments($codes, $periodo['mes'], $periodo['anio']) as $assignment) {
            $origin = trim((string)($assignment['codVendedorOrigen'] ?? ''));
            if (!isset($selected[$this->sharedCodeKey($origin)])) {
                continue;
            }
            $destination = trim((string)($assignment['codVendedorDestino'] ?? ''));
            $rows[] = [
                'id' => (int)($assignment['id'] ?? 0),
                'folio' => (string)($assignment['folio'] ?? ''),
                'fecha' => (string)($assignment['fecha'] ?? ''),
                'cliente' => trim((string)($assignment['cliente'] ?? '')),
                'CodigoAsignador' => $origin,
                'NombreAsignador' => $this->getVendorName($origin),
                'CodigoAsignado' => $destination,
                'NombreAsignado' => $this->getVendorName($destination),
                'porcentaje' => (float)($assignment['porcentaje'] ?? 0),
                'MontoAsignado' => (float)($assignment['monto_asignado'] ?? 0),
            ];
        }

        return [
            'ok' => true,
            'ventasCompartidasEntregadas' => $rows,
            'totales' => [
                'folios' => count($rows),
                'monto' => array_sum(array_column($rows, 'MontoAsignado')),
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
        $saleExpression = $this->commercialAmountSql('enc.Tipo', 'm.TotLinea');
        $realExpression = $this->commercialAmountSql('enc.Tipo', 'm.CantFacturada * ISNULL(t.PrecioVta, 0)');
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
                SUM(%s) AS monto,
                SUM(%s) AS venta_lista_folio
             FROM [PRODIN].[softland].[iw_gsaen] enc
             INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = enc.NroInt AND m.Tipo = enc.Tipo
             LEFT JOIN [PRODIN].[softland].[iw_tprod] t ON t.CodProd = m.CodProd
             LEFT JOIN [PRODIN].[softland].[cwtauxi] c ON c.CodAux = enc.CodAux
             WHERE enc.CodVendedor IN (%s)
                AND enc.Tipo IN ('F', 'N', 'D')
                AND enc.Estado <> 'A'
                AND MONTH(enc.Fecha) = ? AND YEAR(enc.Fecha) = ?
             GROUP BY enc.Folio, enc.Fecha, enc.CodAux, CONVERT(varchar(max), enc.NomAux), CONVERT(varchar(max), c.NomAux), enc.CodVendedor, enc.Tipo
             ORDER BY enc.Fecha DESC, enc.Folio DESC",
            $saleExpression,
            $realExpression,
            implode(',', array_fill(0, count($vendCodes), '?'))
        );
        $stmt = $pool->prepare($sql);
        $stmt->execute(array_merge($vendCodes, [$mes, $anio]));
        $ventas = [];
        $codeTypeMap = $this->vendorCodeTypeMapFromUserId($userId);
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $code = trim((string)($row['CodVendedor'] ?? ''));
            $type = $this->vendorCodeType($code, $codeTypeMap);
            $factor = $this->vendorCodeParticipationFactor($type);
            $monto = $this->asFloat($row['monto'] ?? 0) * $factor;
            $lista = $this->asFloat($row['venta_lista_folio'] ?? 0) * $factor;
            $ventas[] = [
                'Folio' => (int)($row['Folio'] ?? 0),
                'fecha_formato' => (string)($row['fecha_formato'] ?? ''),
                'cliente' => trim((string)($row['cliente'] ?? '')),
                'CodAux' => trim((string)($row['CodAux'] ?? '')),
                'CodVendedor' => $code,
                'tipoCodigo' => $type,
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
        $saleExpression = $this->commercialAmountSql('h.Tipo', 'm.TotLinea');
        $realExpression = $this->commercialAmountSql('h.Tipo', 'm.CantFacturada * ISNULL(t.PrecioVta, 0)');
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
                $saleExpression AS TotLinea,
                $realExpression AS neto_real,
                $saleExpression AS neto_total,
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
            $totalReal = $this->commercialAmount(
                $this->lineListTotal($cantidad, $precioLista),
                $row['Tipo'] ?? ''
            );
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

    public function carteraForUser(
        int $userId,
        array $query,
        int $diasInactividad = 180,
        int $diasRecuperacion = 180
    ): array
    {
        if ($userId <= 0) {
            throw new RuntimeException('Vendedor invalido.', 400);
        }
        if ($diasInactividad < 1 || $diasRecuperacion < 1) {
            throw new RuntimeException('Las ventanas de cartera deben ser positivas.', 400);
        }

        return $this->carteraOptimizada(['sub' => $userId], $query, $diasRecuperacion, $diasInactividad);
    }

    private function clasificarClienteCartera(
        ?DateTimeImmutable $fechaPrimera,
        ?DateTimeImmutable $fechaUltimaPrevia,
        ?DateTimeImmutable $fechaPrimeraPeriodo,
        DateTimeImmutable $desde,
        DateTimeImmutable $hasta,
        ?int $diasRecuperacion
    ): array {
        $esNuevo = $fechaPrimera !== null && $fechaPrimera >= $desde && $fechaPrimera <= $hasta;
        $diasInactividad = $fechaUltimaPrevia && $fechaPrimeraPeriodo
            ? (int)$fechaUltimaPrevia->diff($fechaPrimeraPeriodo)->days
            : null;
        $esRecuperadoBase = !$esNuevo && $fechaUltimaPrevia !== null && $fechaPrimeraPeriodo !== null;
        $esRecuperado = $diasRecuperacion === null
            ? $esRecuperadoBase
            : $esRecuperadoBase && $diasInactividad !== null && $diasInactividad >= $diasRecuperacion;

        return [
            'nuevo' => $esNuevo,
            'recuperado' => $esRecuperado,
            'diasInactividad' => $diasInactividad,
        ];
    }

    private function carteraOptimizada(
        array $payload,
        array $query,
        ?int $diasRecuperacion = null,
        int $diasInactividad = 90
    ): array
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
                'ClientesActivosMesActual' => 0,
                'DiasInactividad' => $diasInactividad,
                'DiasRecuperacion' => $diasRecuperacion,
                'total' => [], 'activos' => [], 'inactivos' => [], 'nuevos' => [], 'recuperados' => [], 'activosMesActual' => [],
            ];
        }

        $desde = new DateTimeImmutable($this->monthStart($anio, $mes));
        $hasta = new DateTimeImmutable($this->monthEnd($anio, $mes));
        $ventanaActiva = $hasta->modify(sprintf('-%d days', $diasInactividad));
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
                'ClientesActivosMesActual' => 0,
                'DiasInactividad' => $diasInactividad,
                'DiasRecuperacion' => $diasRecuperacion,
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
                    MAX(CASE WHEN h.Fecha < ? THEN CONVERT(date, h.Fecha) END) AS FechaUltimaPrevia,
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
            [$fechaDesde, $fechaHasta, $fechaDesde, $fechaHasta, $fechaDesde, $fechaDesde, $fechaActivaDesde],
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
            $fechaUltimaPrevia = !empty($row['FechaUltimaPrevia']) ? new DateTimeImmutable((string)$row['FechaUltimaPrevia']) : null;

            $esActivo = (bool)($row['EsActivo'] ?? 0);
            $esInactivo = !$esActivo;
            $clasificacion = $this->clasificarClienteCartera(
                $fechaPrimera,
                $fechaUltimaPrevia,
                $fechaMinMes,
                $desde,
                $hasta,
                $diasRecuperacion
            );
            $esNuevo = $clasificacion['nuevo'];
            $esRecuperado = $clasificacion['recuperado'];
            $diasInactividadPrevia = $clasificacion['diasInactividad'];
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
                'FechaUltimaCompraPrevia' => $fechaUltimaPrevia?->format('Y-m-d'),
                'DiasInactividadPrevia' => $diasInactividadPrevia,
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
            'ClientesActivosMesActual' => count($activosMesActual),
            'DiasInactividad' => $diasInactividad,
            'DiasRecuperacion' => $diasRecuperacion,
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
        $saleExpression = $this->commercialAmountSql('h.Tipo', 'm.TotLinea');
        $sql = "
            SELECT TOP 200
                h.Folio,
                CONVERT(varchar(10), h.Fecha, 103) AS fecha_formato,
                COALESCE(NULLIF(LTRIM(RTRIM(c.NomAux)), ''), NULLIF(LTRIM(RTRIM(h.CodAux)), '')) AS cliente,
                ROUND(SUM($saleExpression), 0) AS monto,
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

        $hydratedById = [];
        foreach ($this->fetchSharedAssignments($codes, $mes, $anio) as $assignment) {
            $hydratedById[(int)($assignment['id'] ?? 0)] = $assignment;
        }

        return array_map(static function (array $row) use ($hydratedById): array {
            $hydrated = $hydratedById[(int)($row['id'] ?? 0)] ?? [];
            $montoNeto = (float)($hydrated['monto_neto'] ?? $row['monto_neto'] ?? 0);
            $montoAsignado = (float)($hydrated['monto_asignado'] ?? $row['monto_asignado'] ?? 0);
            return [
                'id' => (int)($row['id'] ?? 0),
                'folio' => (string)($row['folio'] ?? ''),
                'fecha' => (string)($row['fecha'] ?? ''),
                'cliente' => trim((string)($row['cliente'] ?? '')),
                'monto_neto' => $montoNeto,
                'monto_asignado' => $montoAsignado,
                'porcentaje' => (float)($row['porcentaje'] ?? 0),
                'cod_vendedor_principal' => trim((string)($row['cod_vendedor_principal'] ?? '')),
                'cod_vendedor_compartido' => trim((string)($row['cod_vendedor_compartido'] ?? '')),
                'nombre_vendedor_compartido' => trim((string)($row['nombre_vendedor_compartido'] ?? '')),
                'monto' => $montoAsignado,
                'coordinador' => trim((string)($row['coordinador'] ?? '')),
                'tipo' => strtoupper(trim((string)($hydrated['tipoDocumento'] ?? ''))),
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

        $allCodes = array_values(array_unique(array_merge($coordinatorCodes, $vendorCodes)));
        $hydratedById = [];
        foreach ($this->fetchSharedAssignments(
            $allCodes,
            $periodoSolicitado['mes'],
            $periodoSolicitado['anio']
        ) as $assignment) {
            $hydratedById[(int)($assignment['id'] ?? 0)] = $assignment;
        }
        foreach ($rows as &$row) {
            $hydrated = $hydratedById[(int)($row['id'] ?? 0)] ?? null;
            if ($hydrated === null) {
                continue;
            }
            $row['monto_neto'] = (float)($hydrated['monto_neto'] ?? $row['monto_neto'] ?? 0);
            $row['monto_asignado'] = (float)($hydrated['monto_asignado'] ?? $row['monto_asignado'] ?? 0);
            $row['monto'] = $row['monto_asignado'];
            $row['tipo'] = strtoupper(trim((string)($hydrated['tipoDocumento'] ?? '')));
        }
        unset($row);

        return [
            'ok' => true,
            'periodo_solicitado' => $periodoSolicitado,
            'asignados' => $rows,
        ];
    }

    public function categoriasVendedor(array $payload, array $query): array
    {
        $userId = $this->currentUserIdFromPayload($payload);
        $codes = array_values(array_unique(array_filter(array_map(
            static fn(mixed $code): string => trim((string)$code),
            $this->getVendorCodes($userId)
        ))));
        if (!$codes) {
            return ['vendedores' => [], 'todasLasCategorias' => []];
        }

        $periodo = $this->monthYear($query);
        $mes = $periodo['mes'];
        $anio = $periodo['anio'];
        $catRows = $this->db->fetchAll('SELECT Cta, Categoria FROM categoriasproducto');
        $catMap = [];
        foreach ($catRows as $row) {
            $category = trim((string)($row['Categoria'] ?? ''));
            if ($category !== '') {
                $catMap[$category] = true;
            }
        }

        $assignments = $this->fetchSharedAssignments($codes, $mes, $anio);
        $productCategories = $this->sharedProductCategories($assignments, $mes, $anio);
        $codeTypeMap = $this->vendorCodeTypeMapFromUserId($userId);
        $resultado = [];
        foreach ($codes as $cod) {
            $categorias = $this->sharedCategoryDistribution(
                [$cod],
                $mes,
                $anio,
                $assignments,
                $productCategories,
                $codeTypeMap
            );
            $resultado[] = ['codVendedor' => $cod, 'categorias' => $categorias];
            foreach ($categorias as $category) {
                $name = trim((string)($category['categoria'] ?? ''));
                if ($name !== '') {
                    $catMap[$name] = true;
                }
            }
        }

        return [
            'vendedores' => $resultado,
            'todasLasCategorias' => array_keys($catMap),
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


