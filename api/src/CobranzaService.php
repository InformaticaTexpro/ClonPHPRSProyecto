<?php
declare(strict_types=1);

require_once __DIR__ . '/ConcursoCierreStore.php';

final class CobranzaService
{
    use SharedServiceHelpers;

    private ?array $relations = null;

    public function __construct(private Database $db, private AnalyticsService $analytics) {}

    public function route(array $payload, string $method, string $path, array $query): array
    {
        $this->currentUserIdFromPayload($payload);
        $notes = str_starts_with($path, '/control-notas-venta');
        $menuCode = $notes ? 'cobranza_control_notas_venta' : 'cobranza_control_clientes';
        $allowed = (bool)($payload['is_admin'] ?? false);
        foreach (array_merge($payload['menus'] ?? [], $payload['menus_directos'] ?? []) as $menu) {
            if (($menu['codigo'] ?? '') === $menuCode) $allowed = true;
        }
        if (!$allowed) throw new RuntimeException($notes ? 'Sin acceso a Control de Notas de Venta.' : 'Sin acceso a Control de Clientes.', 403);
        if ($method !== 'GET') throw new RuntimeException('Método no permitido.', 405);
        return match ($path) {
            '/control-notas-venta' => $this->controlNotasVentaResumen($query),
            '/control-notas-venta/alerta' => $this->controlNotasVentaDetalle($query, true),
            '/control-notas-venta/detalle' => $this->controlNotasVentaDetalle($query),
            '/opciones' => $this->options(),
            '/control-clientes' => $this->report($query),
            '/control-clientes/evolucion' => $this->evolution($query),
            '/control-clientes/evolucion-detalle' => $this->evolutionDetail($query),
            default => throw new RuntimeException('Ruta de Cobranza no encontrada.', 404),
        };
    }

    private function nvFilters(array $query): array
    {
        $dates = [];
        foreach (['desde' => date('Y-01-01'), 'hasta' => date('Y-m-d')] as $key => $default) {
            $raw = $query[$key] ?? $default;
            $date = is_string($raw) && preg_match('/^\d{4}-\d{2}-\d{2}$/D', $raw)
                ? DateTimeImmutable::createFromFormat('!Y-m-d', $raw) : false;
            if (!$date || $date->format('Y-m-d') !== $raw || (int)$date->format('Y') < 2000 || (int)$date->format('Y') > 9998) {
                throw new RuntimeException('Fecha ' . $key . ' inválida.', 400);
            }
            $dates[$key] = $date;
        }
        if ($dates['desde'] > $dates['hasta']) throw new RuntimeException('Desde no puede ser posterior a Hasta.', 400);
        $attention = filter_var($query['diasAtencion'] ?? 30, FILTER_VALIDATE_INT);
        $critical = filter_var($query['diasCritica'] ?? 60, FILTER_VALIDATE_INT);
        if (!$attention || $attention < 1 || !$critical || $critical <= $attention || $critical > 2147483647) {
            throw new RuntimeException('Atención debe ser al menos 1 día y Crítica debe ser mayor que Atención.', 400);
        }
        if (isset($query['vendedor']) && !is_string($query['vendedor'])) throw new RuntimeException('Vendedor no válido.', 400);
        $vendor = trim((string)($query['vendedor'] ?? ''));
        $vendorId = $vendor === '' ? null : filter_var($vendor, FILTER_VALIDATE_INT);
        if ($vendor !== '' && (!$vendorId || $vendorId < 1)) throw new RuntimeException('Vendedor no válido.', 400);
        $codes = [];
        if ($vendorId !== null) foreach ($this->relations() as $relation) {
            if ((int)$relation['usuarioId'] === $vendorId && (bool)$relation['activo']) $codes[] = trim((string)$relation['codigoAsociado']);
        }
        $codes = array_values(array_unique(array_filter($codes, static fn(string $code): bool => $code !== '')));
        return ['desde' => $dates['desde']->format('Y-m-d'), 'hasta' => $dates['hasta']->format('Y-m-d'),
            'fin' => $dates['hasta']->modify('+1 day')->format('Y-m-d'), 'vendedor' => $vendor, 'codigosVendedor' => $codes,
            'diasAtencion' => $attention, 'diasCritica' => $critical,
            'diasRango' => $dates['desde']->diff($dates['hasta'])->days + 1];
    }

    private function nvBase(array $filters): array
    {
        $where = '';
        $params = [$filters['desde'], $filters['fin']];
        if ($filters['vendedor'] !== '') {
            $codes = $filters['codigosVendedor'];
            $where = $codes ? ' AND LTRIM(RTRIM(n.VenCod)) IN (' . implode(',', array_fill(0, count($codes), '?')) . ')' : ' AND 1 = 0';
            array_push($params, ...$codes);
        }
        return ["WITH Base AS (SELECT n.NVNumero, n.nvFem AS fecha,
            UPPER(LTRIM(RTRIM(COALESCE(n.nvEstado, '')))) AS estado, n.CodAux, n.VenCod, n.NumOC,
            COALESCE(n.nvSubTotal, 0) AS monto,
            DATEDIFF(DAY, CAST(n.nvFem AS date), CAST(GETDATE() AS date)) AS dias
            FROM [PRODIN].[softland].[nw_nventa] n WHERE n.nvFem >= ? AND n.nvFem < ? $where)", $params];
    }

    private function controlNotasVentaResumen(array $query): array
    {
        $filters = $this->nvFilters($query);
        [$base, $params] = $this->nvBase($filters);
        $groups = $this->rows($base . ", Clasificada AS (SELECT *, CASE WHEN estado IN ('A','P') THEN
            CASE WHEN dias >= ? THEN 'critica' WHEN dias >= ? THEN 'atencion' ELSE 'plazo' END ELSE '' END AS segmento,
            CASE WHEN estado = 'C' THEN CASE WHEN EXISTS (
                SELECT 1 FROM [PRODIN].[softland].[iw_gsaen] g
                WHERE g.nvnumero = b.NVNumero AND g.Tipo = 'F' AND g.Estado = 'V'
            ) THEN 'FACTURADA' ELSE 'CIERRE_LIMPIEZA' END ELSE '' END AS cierreTipo
            FROM Base b) SELECT estado, segmento, cierreTipo, COUNT_BIG(*) AS cantidad, SUM(monto) AS monto,
            SUM(CAST(dias AS float)) AS sumaDias, MAX(dias) AS mayorEdad
            FROM Clasificada GROUP BY estado, segmento, cierreTipo", array_merge($params, [$filters['diasCritica'], $filters['diasAtencion']]));
        $empty = ['cantidad' => 0, 'monto' => 0.0];
        $kpis = array_fill_keys(['emitidas', 'concluidas', 'pendientes', 'nulas', 'aprobadas', 'sinAprobar', 'facturadas', 'cierreLimpieza'], $empty);
        $alerts = array_fill_keys(['critica', 'atencion', 'plazo'], $empty + ['masAntigua' => null]);
        $ageSum = 0.0;
        $oldest = null;
        foreach ($groups as $group) {
            $count = (int)$group['cantidad'];
            $amount = (float)$group['monto'];
            $keys = ['emitidas'];
            if ($group['estado'] === 'C') {
                $keys[] = 'concluidas';
                $keys[] = $group['cierreTipo'] === 'FACTURADA' ? 'facturadas' : 'cierreLimpieza';
            }
            if ($group['estado'] === 'N') $keys[] = 'nulas';
            if (in_array($group['estado'], ['A', 'P'], true)) {
                $keys[] = 'pendientes';
                $keys[] = $group['estado'] === 'A' ? 'aprobadas' : 'sinAprobar';
                $segment = $group['segmento'];
                $alerts[$segment]['cantidad'] += $count;
                $alerts[$segment]['monto'] += $amount;
                $alerts[$segment]['masAntigua'] = $alerts[$segment]['masAntigua'] === null ? (int)$group['mayorEdad'] : max($alerts[$segment]['masAntigua'], (int)$group['mayorEdad']);
                $ageSum += (float)$group['sumaDias'];
                $oldest = $oldest === null ? (int)$group['mayorEdad'] : max($oldest, (int)$group['mayorEdad']);
            }
            foreach ($keys as $key) { $kpis[$key]['cantidad'] += $count; $kpis[$key]['monto'] += $amount; }
        }
        $reconciles = array_sum(array_column($alerts, 'cantidad')) === $kpis['pendientes']['cantidad']
            && abs(array_sum(array_column($alerts, 'monto')) - $kpis['pendientes']['monto']) < .01;
        if (!$reconciles) throw new RuntimeException('Las alertas no concilian con las NV pendientes. Reintente la consulta.', 500);
        if ($kpis['facturadas']['cantidad'] + $kpis['cierreLimpieza']['cantidad'] !== $kpis['concluidas']['cantidad']
            || abs($kpis['facturadas']['monto'] + $kpis['cierreLimpieza']['monto'] - $kpis['concluidas']['monto']) >= .01) {
            throw new RuntimeException('El desglose de Concluidas no concilia en cantidad o monto neto.', 500);
        }
        $bucket = $filters['diasRango'] <= 90 ? 'CONVERT(varchar(10), fecha, 23)' : "CONVERT(char(7), fecha, 23) + '-01'";
        $evolution = $this->rows($base . " SELECT $bucket AS periodo, COUNT_BIG(*) AS emitidas,
            SUM(CASE WHEN estado = 'C' THEN 1 ELSE 0 END) AS concluidas,
            SUM(CASE WHEN estado IN ('A','P') THEN 1 ELSE 0 END) AS pendientes,
            SUM(monto) AS montoEmitidas, SUM(CASE WHEN estado = 'C' THEN monto ELSE 0 END) AS montoConcluidas,
            SUM(CASE WHEN estado IN ('A','P') THEN monto ELSE 0 END) AS montoPendientes
            FROM Base GROUP BY $bucket ORDER BY periodo", $params);
        $byClient = $filters['vendedor'] !== '';
        if ($byClient) {
            $name = "COALESCE(NULLIF(RTRIM(a.NomAux), ''), b.CodAux, 'Sin cliente')";
            $ranking = $this->rows($base . " SELECT TOP (10) b.CodAux AS codigo, $name AS nombre,
                COUNT_BIG(*) AS cantidad, SUM(b.monto) AS monto FROM Base b
                LEFT JOIN [PRODIN].[softland].[cwtauxi] a ON a.CodAux = b.CodAux
                WHERE b.estado IN ('A','P') GROUP BY b.CodAux, $name ORDER BY monto DESC, nombre", $params);
        } else {
            $byCode = [];
            foreach ($this->relations() as $relation) {
                if (!(bool)$relation['activo']) continue;
                $byCode[trim((string)$relation['codigoAsociado'])][(int)$relation['usuarioId']] = $relation['vendedor'];
            }
            $byUser = [];
            foreach ($this->rows($base . " SELECT LTRIM(RTRIM(b.VenCod)) AS codigo,
                COUNT_BIG(*) AS cantidad, SUM(b.monto) AS monto FROM Base b
                WHERE b.estado IN ('A','P') GROUP BY LTRIM(RTRIM(b.VenCod))", $params) as $row) {
                foreach ($byCode[$row['codigo']] ?? [] as $id => $name) {
                    $byUser[$id] ??= ['usuarioId' => $id, 'nombre' => $name, 'cantidad' => 0, 'monto' => 0.0];
                    $byUser[$id]['cantidad'] += (int)$row['cantidad'];
                    $byUser[$id]['monto'] += (float)$row['monto'];
                }
            }
            $ranking = array_values($byUser);
            usort($ranking, static fn(array $a, array $b): int => ($b['monto'] <=> $a['monto']) ?: strnatcasecmp($a['nombre'], $b['nombre']));
        }
        foreach ($evolution as &$row) foreach (['emitidas', 'concluidas', 'pendientes', 'montoEmitidas', 'montoConcluidas', 'montoPendientes'] as $key) $row[$key] = (float)$row[$key];
        unset($row);
        foreach ($ranking as &$row) { $row['cantidad'] = (int)$row['cantidad']; $row['monto'] = (float)$row['monto']; }
        unset($row);
        $result = ['ok' => true, 'filtros' => array_diff_key($filters, ['fin' => true, 'codigosVendedor' => true]), 'kpis' => $kpis, 'alertas' => $alerts,
            'indicadores' => ['edadPromedio' => $kpis['pendientes']['cantidad'] ? $ageSum / $kpis['pendientes']['cantidad'] : 0,
                'masAntigua' => $oldest, 'ticketPromedio' => $kpis['pendientes']['cantidad'] ? $kpis['pendientes']['monto'] / $kpis['pendientes']['cantidad'] : 0,
                'porcentajeConclusion' => $kpis['emitidas']['cantidad'] ? 100 * $kpis['concluidas']['cantidad'] / $kpis['emitidas']['cantidad'] : 0],
            'evolucion' => $evolution, 'agrupacion' => $filters['diasRango'] <= 90 ? 'diaria' : 'mensual',
            'ranking' => $ranking, 'rankingTipo' => $byClient ? 'clientes' : 'vendedores', 'conciliado' => $reconciles];
        if (($query['incluirVendedores'] ?? '') === '1') {
            $result['vendedores'] = array_map(static fn(array $vendor): array =>
                ['usuarioId' => $vendor['usuarioId'], 'nombre' => $vendor['nombre']], $this->vendors());
        }
        return $result;
    }

    private function controlNotasVentaDetalle(array $query, bool $alert = false): array
    {
        $filters = $this->nvFilters($query);
        [$base, $params] = $this->nvBase($filters);
        $where = '';
        if ($alert) {
            $segment = $query['segmento'] ?? '';
            $where = match ($segment) {
                'critica' => " WHERE b.estado IN ('A','P') AND b.dias >= ?",
                'atencion' => " WHERE b.estado IN ('A','P') AND b.dias >= ? AND b.dias < ?",
                'plazo' => " WHERE b.estado IN ('A','P') AND b.dias < ?",
                default => throw new RuntimeException('Segmento no válido.', 400),
            };
            array_push($params, ...match ($segment) {
                'critica' => [$filters['diasCritica']], 'atencion' => [$filters['diasAtencion'], $filters['diasCritica']], 'plazo' => [$filters['diasAtencion']],
            });
        }
        $page = filter_var($query['pagina'] ?? 1, FILTER_VALIDATE_INT);
        if (!$page || $page < 1 || $page > 10000000) throw new RuntimeException('Página no válida.', 400);
        $size = 100;
        $totals = $this->rows($base . " SELECT COUNT_BIG(*) AS cantidad, COALESCE(SUM(b.monto), 0) AS montoTotal FROM Base b $where", $params)[0];
        $extra = $alert ? '' : ', b.dias, b.estado, b.NumOC AS oc';
        $rows = $this->rows($base . " SELECT b.NVNumero, CONVERT(varchar(10), b.fecha, 23) AS fecha,
            COALESCE(NULLIF(RTRIM(a.NomAux), ''), b.CodAux, 'Sin cliente') AS cliente,
            COALESCE(NULLIF(RTRIM(v.VenDes), ''), b.VenCod, 'Sin vendedor') AS vendedor, b.monto $extra
            FROM Base b LEFT JOIN [PRODIN].[softland].[cwtauxi] a ON a.CodAux = b.CodAux
            LEFT JOIN [PRODIN].[softland].[cwtvend] v ON v.VenCod = b.VenCod $where
            ORDER BY b.fecha DESC, b.NVNumero DESC OFFSET CAST(? AS int) ROWS FETCH NEXT CAST(? AS int) ROWS ONLY", array_merge($params, [($page - 1) * $size, $size]));
        foreach ($rows as &$row) { $row['monto'] = (float)$row['monto']; if (!$alert) $row['dias'] = (int)$row['dias']; }
        unset($row);
        return ['ok' => true, 'cantidad' => (int)$totals['cantidad'], 'montoTotal' => (float)$totals['montoTotal'],
            'pagina' => $page, 'tamanoPagina' => $size, 'hayMas' => $page * $size < (int)$totals['cantidad'], 'notas' => $rows];
    }

    private function relations(): array
    {
        return $this->relations ??= $this->db->fetchAll("SELECT u.id AS usuarioId, u.codigo AS codigoPrincipal,
            u.nombre AS vendedor, u.area, u.is_active AS activo, uv.cod_vendedor AS codigoAsociado, uv.tipo
            FROM usuario u INNER JOIN usuario_vendedor uv ON uv.usuario_id = u.id
            WHERE uv.cod_vendedor IS NOT NULL AND TRIM(uv.cod_vendedor) <> '' ORDER BY u.nombre, u.id");
    }

    private function vendors(): array
    {
        $vendors = [];
        foreach ($this->relations() as $relation) {
            $id = (int)$relation['usuarioId'];
            if (!(bool)$relation['activo'] || isset($vendors[$id])) continue;
            $vendors[$id] = ['usuarioId' => $id, 'nombre' => $relation['vendedor'],
                'codigo' => trim((string)$relation['codigoPrincipal']) ?: trim((string)$relation['codigoAsociado'])];
        }
        return array_values($vendors);
    }

    private function options(): array
    {
        $years = [(int)date('Y')];
        foreach ($this->rows("SELECT DISTINCT YEAR(Fecha) AS anio FROM [PRODIN].[softland].[iw_gsaen]
            WHERE Tipo = 'F' AND Estado <> 'A' AND Fecha >= '20000101' AND Fecha < ?", [date('Y-m-d', strtotime('+1 day'))]) as $row) {
            $years[] = (int)$row['anio'];
        }
        $years = array_values(array_unique($years));
        rsort($years);
        return ['ok' => true, 'vendedores' => $this->vendors(), 'anios' => $years];
    }

    private function filters(array $query): array
    {
        $dates = [];
        foreach (['desde' => date('Y-m-01'), 'hasta' => date('Y-m-d')] as $name => $default) {
            $raw = $query[$name] ?? $default;
            $date = is_string($raw) && preg_match('/^\d{4}-\d{2}-\d{2}$/D', $raw)
                ? DateTimeImmutable::createFromFormat('!Y-m-d', $raw) : false;
            if (!$date || $date->format('Y-m-d') !== $raw || (int)$date->format('Y') < 2000) {
                throw new RuntimeException('Fecha ' . $name . ' inválida. Use AAAA-MM-DD.', 400);
            }
            $dates[$name] = $date;
        }
        if ($dates['desde'] > $dates['hasta']) throw new RuntimeException('Desde no puede ser posterior a Hasta.', 400);
        if (isset($query['vendedorId']) && !is_scalar($query['vendedorId'])) throw new RuntimeException('Vendedor no válido.', 400);
        $vendor = trim((string)($query['vendedorId'] ?? ''));
        if ($vendor !== '' && (!ctype_digit($vendor) || !in_array((int)$vendor, array_column($this->vendors(), 'usuarioId'), true))) {
            throw new RuntimeException('Vendedor no válido.', 400);
        }
        $identity = null;
        if (isset($query['cliente']) && !is_string($query['cliente'])) throw new RuntimeException('Cliente no válido.', 400);
        $client = trim((string)($query['cliente'] ?? ''));
        if (strlen($client) > 240 || !preg_match('//u', $client)) throw new RuntimeException('Cliente no válido.', 400);
        if (isset($query['rut']) && !is_string($query['rut'])) throw new RuntimeException('RUT no válido.', 400);
        $rut = trim((string)($query['rut'] ?? ''));
        if ($rut !== '') {
            if (strlen($rut) > 80) throw new RuntimeException('RUT no válido.', 400);
            // La misma expresion central de RutAux, tambien para el valor del filtro.
            $sql = 'SELECT ' . AnalyticsService::newClientIdentitySql('?', "''") . ' AS identidad';
            $identity = $this->rows($sql, array_fill(0, substr_count($sql, '?'), $rut))[0]['identidad'];
            if (!str_starts_with($identity, 'RUT:')) throw new RuntimeException('RUT no válido.', 400);
        }
        return ['desde' => $dates['desde']->format('Y-m-d'), 'hasta' => $dates['hasta']->format('Y-m-d'),
            'fin' => $dates['hasta']->modify('+1 day')->format('Y-m-d'), 'rut' => $rut, 'cliente' => $client,
            'identidad' => $identity, 'vendedorId' => $vendor === '' ? null : (int)$vendor];
    }

    private function rows(string $sql, array $params = []): array
    {
        $stmt = $this->db->softland()->prepare($sql);
        $stmt->execute(array_values($params));
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    private function documents(array $filters, array $scope = []): array
    {
        $amount = $this->commercialAmountSql('h.Tipo', 'm.TotLinea');
        $rutFilter = '';
        $params = [$filters['desde'], $filters['fin']];
        if ($filters['identidad'] !== null) {
            $identity = AnalyticsService::newClientIdentitySql('r.RutAux', 'r.CodAux');
            $rutFilter = " AND h.CodAux IN (SELECT r.CodAux FROM [PRODIN].[softland].[cwtauxi] r WHERE $identity = ?)";
            $params[] = $filters['identidad'];
        }
        if (!empty($scope['codes'])) {
            $in = implode(',', array_fill(0, count($scope['codes']), '?'));
            $ownerMatch = 'a.CodAux = h.CodAux';
            if ($scope['kind'] === 'nuevos') {
                // Conservar todos los CodAux de la identidad RUT, sin recortar sus importes.
                $ownedIdentity = AnalyticsService::newClientIdentitySql('owned.RutAux', 'a.CodAux');
                $documentIdentity = AnalyticsService::newClientIdentitySql('cli.RutAux', 'h.CodAux');
                $ownerMatch = "($ownerMatch OR $ownedIdentity = $documentIdentity)";
            }
            $rutFilter .= " AND EXISTS (SELECT 1 FROM [PRODIN].[softland].[cwtauxven] a
                LEFT JOIN [PRODIN].[softland].[cwtauxi] owned ON owned.CodAux = a.CodAux
                WHERE $ownerMatch AND (LTRIM(RTRIM(a.VenCod)) IN ($in)
                    OR TRY_CONVERT(bigint, a.VenCod) IN ($in)))";
            array_push($params, ...$scope['codes'], ...array_map(static fn(string $code) => ctype_digit($code) ? (int)$code : null, $scope['codes']));
        }
        return $this->rows("SELECT LTRIM(RTRIM(h.CodAux)) AS clienteCodigo,
            LTRIM(RTRIM(h.CodVendedor)) AS codigoVendedor, h.NroInt, h.Tipo AS tipo, h.Folio AS folio,
            CONVERT(varchar(10), h.Fecha, 23) AS fecha,
            MAX(CONVERT(varchar(80), cli.RutAux)) AS rut,
            MAX(RTRIM(COALESCE(cli.NomAux, h.NomAux, h.CodAux))) AS cliente, SUM($amount) AS original
            FROM [PRODIN].[softland].[iw_gsaen] h
            LEFT JOIN [PRODIN].[softland].[cwtauxi] cli ON cli.CodAux = h.CodAux
            INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = h.NroInt AND m.Tipo = h.Tipo
            INNER JOIN [PRODIN].[softland].[iw_tprod] t ON t.CodProd = m.CodProd
            WHERE h.Tipo IN ('F','N','D') AND h.Estado <> 'A' AND h.Fecha >= ? AND h.Fecha < ? $rutFilter
            GROUP BY h.CodAux, h.CodVendedor, h.NroInt, h.Tipo, h.Folio, CONVERT(varchar(10), h.Fecha, 23)
            ORDER BY fecha, h.NroInt, h.Folio", $params);
    }

    private function sharedKey(array $doc): string
    {
        return substr($doc['fecha'], 0, 7) . '|' . $this->analytics->sharedCodeKey($doc['codigoVendedor'])
            . '|' . $this->analytics->sharedFolioKey($doc['folio']);
    }

    private function hydrate(array $documents, array $filters): array
    {
        $owners = $types = $users = [];
        foreach ($this->relations() as $relation) {
            $id = (int)$relation['usuarioId'];
            $code = $this->analytics->sharedCodeKey($relation['codigoAsociado']);
            $owners[$code][$id] = true;
            $types[$id][$code] = $relation['tipo'];
            $users[$id] = ['usuarioId' => $id, 'nombre' => $relation['vendedor'], 'area' => $relation['area']];
        }
        $shared = [];
        $shareStart = (new DateTimeImmutable($filters['desde']))->format('Y-m-01');
        $shareEnd = (new DateTimeImmutable($filters['hasta']))->modify('first day of next month')->format('Y-m-d');
        foreach ($this->db->fetchAll("SELECT folio, fecha, porcentaje, cod_vendedor_principal AS origen,
            cod_vendedor_compartido AS destino FROM factura_compartida
            WHERE rol = 'compartido' AND fecha >= ? AND fecha < ?", [$shareStart, $shareEnd]) as $share) {
            $shared[$this->sharedKey(['fecha' => $share['fecha'], 'codigoVendedor' => $share['origen'], 'folio' => $share['folio']])][] = $share;
        }
        foreach ($documents as &$doc) {
            $code = $this->analytics->sharedCodeKey($doc['codigoVendedor']);
            $shares = $doc['tipo'] === 'F' ? ($shared[$this->sharedKey($doc)] ?? []) : [];
            foreach (array_merge([$doc['codigoVendedor']], array_column($shares, 'destino')) as $rawCode) {
                $key = $this->analytics->sharedCodeKey($rawCode);
                if (isset($owners[$key])) continue;
                $id = 'codigo:' . $key;
                $owners[$key][$id] = true;
                $types[$id][$key] = '';
                $users[$id] = ['usuarioId' => null, 'nombre' => (string)$rawCode, 'area' => ''];
            }
            $doc['original'] = (float)$doc['original'];
            $doc['compartida'] = (bool)$shares;
            $doc['atribuciones'] = [];
            foreach ($this->analytics->clientDocumentAttributions($doc, $owners, $types, $shares) as $id => $part) {
                if ($part['amount'] == 0.0) continue;
                $doc['atribuciones'][] = $users[$id] + ['porcentaje' => $part['factor'] * 100,
                    'ventaAsignada' => $part['amount'], 'atribucion' => array_keys($part['labels']) ?: ['DIRECTA']];
            }
            $doc['vendedor'] = implode(', ', array_map(static fn($id): string => $users[$id]['nombre'], array_keys($owners[$code])));
        }
        unset($doc);
        return $documents;
    }

    private function recoveryHistory(array $codes, array $filters): array
    {
        $result = [];
        foreach (array_chunk($codes, 500) as $batch) {
            $in = implode(',', array_fill(0, count($batch), '?'));
            $rows = $this->rows("WITH Compras AS (
                SELECT LTRIM(RTRIM(h.CodAux)) AS CodAux, CONVERT(date, h.Fecha) AS FechaCompra
                FROM [PRODIN].[softland].[iw_gsaen] h
                WHERE h.CodAux IN ($in) AND h.Tipo = 'F' AND h.Estado <> 'A' AND h.Fecha < ?
                GROUP BY h.CodAux, CONVERT(date, h.Fecha)
            ), Secuencia AS (
                SELECT CodAux, FechaCompra, LAG(FechaCompra) OVER (PARTITION BY CodAux ORDER BY FechaCompra) AS FechaAnterior
                FROM Compras
            ) SELECT CodAux, CONVERT(varchar(10), FechaCompra, 23) AS fecha,
                CONVERT(varchar(10), FechaAnterior, 23) AS anterior FROM Secuencia WHERE FechaCompra >= ?",
                array_merge($batch, [$filters['fin'], $filters['desde']]));
            foreach ($rows as $row) $result[$row['CodAux']][$row['fecha']] = $row['anterior'];
        }
        return $result;
    }

    private function group(string $kind, string $key, array $doc, array $extra): array
    {
        return ['id' => $kind . '|' . $key, 'categoria' => $kind, 'codigoCliente' => $doc['clienteCodigo'],
            'cliente' => $doc['cliente'], 'rut' => trim((string)$doc['rut']), 'fecha' => $doc['fecha'],
            'periodo' => substr($doc['fecha'], 0, 7), 'codigos' => [], 'ventaTotal' => 0.0,
            'participantes' => [], 'compartida' => false, 'folios' => [], 'concurso' => null] + $extra;
    }

    private function addDocument(array &$group, array $doc): void
    {
        $group['ventaTotal'] += $doc['original'];
        $group['codigos'][$doc['clienteCodigo']] = true;
        $group['compartida'] = $group['compartida'] || $doc['compartida'];
        $group['folios'][] = $doc;
        foreach ($doc['atribuciones'] as $part) {
            $key = $part['usuarioId'] ?? ('codigo:' . $part['nombre']);
            if (!isset($group['participantes'][$key])) $group['participantes'][$key] = array_replace($part, ['ventaAsignada' => 0.0]);
            $group['participantes'][$key]['ventaAsignada'] += $part['ventaAsignada'];
            $group['participantes'][$key]['atribucion'] = array_values(array_unique(array_merge($group['participantes'][$key]['atribucion'], $part['atribucion'])));
        }
    }

    private function clientOwners(array $codes): array
    {
        $byVendor = $owners = [];
        foreach ($this->relations() as $relation) {
            $byVendor[$this->analytics->sharedCodeKey($relation['codigoAsociado'])][(int)$relation['usuarioId']] =
                ['usuarioId' => (int)$relation['usuarioId'], 'nombre' => $relation['vendedor']];
        }
        foreach (array_chunk($codes, 500) as $batch) {
            $in = implode(',', array_fill(0, count($batch), '?'));
            foreach ($this->rows("SELECT DISTINCT LTRIM(RTRIM(CodAux)) AS CodAux, LTRIM(RTRIM(VenCod)) AS VenCod
                FROM [PRODIN].[softland].[cwtauxven] WHERE CodAux IN ($in)", $batch) as $row) {
                foreach ($byVendor[$this->analytics->sharedCodeKey($row['VenCod'])] ?? [] as $id => $owner) {
                    $owners[$row['CodAux']][$id] = $owner;
                }
            }
        }
        return $owners;
    }

    private function report(array $query, bool $withContest = true, array $scope = []): array
    {
        $filters = $this->filters($query);
        $documents = $this->documents($filters, $scope);
        $codes = array_values(array_unique(array_map('strval', array_column($documents, 'clienteCodigo'))));
        $firsts = [];
        foreach (array_chunk($codes, 500) as $batch) $firsts += $this->analytics->firstPurchasesByRut($batch);
        $owners = $this->clientOwners(array_values(array_unique(array_merge($codes, array_column($firsts, 'CodAuxPrimero')))));
        $history = $this->recoveryHistory($codes, $filters);
        $documents = $this->hydrate($documents, $filters);
        $new = $recovered = [];
        foreach ($documents as $doc) {
            $first = $firsts[$doc['clienteCodigo']] ?? null;
            if ($first && $first['FechaPrimeraRut'] >= $filters['desde'] && $first['FechaPrimeraRut'] <= $filters['hasta']
                && (empty($scope['eventOnly']) || substr($doc['fecha'], 0, 7) === substr($first['FechaPrimeraRut'], 0, 7))) {
                $identity = $first['Identidad'];
                if (!isset($new[$identity])) {
                    $new[$identity] = $this->group('nuevos', $identity, $doc, []);
                    $new[$identity]['codigoCliente'] = (string)$first['CodAuxPrimero'];
                    $new[$identity]['fecha'] = $first['FechaPrimeraRut'];
                    $new[$identity]['periodo'] = substr($first['FechaPrimeraRut'], 0, 7);
                    $new[$identity]['codigoCaptacion'] = $first['Vendedor'];
                }
                $this->addDocument($new[$identity], $doc);
            }
            if ($doc['tipo'] !== 'F' || $doc['original'] <= 0) continue;
            $previous = $history[$doc['clienteCodigo']][$doc['fecha']] ?? null;
            if ($previous === null) continue;
            $rules = [];
            // La regla de dias y su comparacion son las mismas de cartera/fallback existentes.
            foreach ($doc['atribuciones'] as $part) {
                $days = $this->analytics->carteraDaysForArea($part['area'])['recuperacion'];
                if (ConcursoVentasService::isRecoveredByDays($previous, $doc['fecha'], $days)) {
                    $rules[] = ['vendedor' => $part['nombre'], 'dias' => $days];
                }
            }
            if (!$rules) continue;
            $key = $doc['clienteCodigo'] . '|' . substr($doc['fecha'], 0, 7);
            if (!isset($recovered[$key])) $recovered[$key] = $this->group('recuperados', $key, $doc,
                ['ultimaCompra' => $previous, 'diasInactividad' => (new DateTimeImmutable($previous))->diff(new DateTimeImmutable($doc['fecha']))->days,
                    'reglas' => $rules]);
        }
        foreach ($documents as $doc) {
            $key = $doc['clienteCodigo'] . '|' . substr($doc['fecha'], 0, 7);
            if (isset($recovered[$key])) $this->addDocument($recovered[$key], $doc);
        }
        $contest = [];
        foreach (['nuevos' => &$new, 'recuperados' => &$recovered] as &$groups) {
            foreach ($groups as $key => &$group) {
                $group['codigos'] = array_map('strval', array_keys($group['codigos']));
                $group['participantes'] = array_values($group['participantes']);
                $group['cantidadFolios'] = count($group['folios']);
                $groupOwners = [];
                foreach (array_unique(array_merge($group['codigos'], [$group['codigoCliente']])) as $code) $groupOwners += $owners[$code] ?? [];
                $group['propietarios'] = array_values($groupOwners);
                // Filtrar el nombre consolidado sin recortar documentos de una misma identidad RUT.
                if ($filters['cliente'] !== '' && !preg_match('/' . preg_quote($filters['cliente'], '/') . '/iu', $group['cliente'])) {
                    unset($groups[$key]);
                    continue;
                }
                if ($filters['vendedorId'] !== null && !in_array($filters['vendedorId'], array_column($group['propietarios'], 'usuarioId'), true)) {
                    unset($groups[$key]);
                    continue;
                }
                if ($withContest) {
                    $period = $group['periodo'];
                    if (!isset($contest[$period])) $contest[$period] = $this->contest($period);
                    $group['concurso'] = $contest[$period][$group['categoria'] . '|' . $group['codigoCliente']] ??
                        ['participa' => false, 'motivo' => str_starts_with($period, '2026-') && substr($period, 5) >= '10' ? 'Sin evento en el cálculo oficial mensual' : 'Fuera de concurso', 'participantes' => []];
                }
            }
            unset($group);
        }
        unset($groups);
        return ['ok' => true, 'filtros' => array_diff_key($filters, ['fin' => true, 'identidad' => true]),
            'resumen' => ['clientesNuevos' => count($new), 'clientesRecuperados' => count($recovered),
                'ventaNuevos' => array_sum(array_column($new, 'ventaTotal')), 'ventaRecuperados' => array_sum(array_column($recovered, 'ventaTotal'))],
            'nuevos' => array_values($new), 'recuperados' => array_values($recovered)];
    }

    private function contest(string $period): array
    {
        [$year, $month] = array_map('intval', explode('-', $period));
        if ($year !== 2026 || !ConcursoVentasService::isActiveForPeriod($year, $month)) return [];
        $saved = (new ConcursoCierreStore())->load($month);
        $closed = ($saved['estado'] ?? null) === 'CERRADO';
        $rows = [];
        if ($closed) {
            foreach ($saved['snapshot']['vendedores'] as $vendor) foreach ($vendor['clientes'] as $kind => $clients) {
                foreach ($clients as $client) $rows[] = array_replace($client, ['usuarioId' => (int)$vendor['usuarioId'], 'categoria' => $kind]);
            }
        } else {
            $relations = array_values(array_filter($this->relations(), static fn(array $r): bool => (bool)$r['activo']));
            $rows = $this->analytics->concursoClientes($relations, $month, null, null, false, true)['clientes'];
        }
        $groups = [];
        $names = array_column($this->relations(), 'vendedor', 'usuarioId');
        foreach ($rows as $row) {
            $key = $row['categoria'] . '|' . $row['clienteCodigo'];
            $groups[$key] ??= ['participa' => true, 'periodo' => $period, 'cerrado' => $closed, 'califica' => false,
                'puntos' => 0.0, 'motivo' => '', 'participantes' => []];
            $groups[$key]['califica'] = $groups[$key]['califica'] || $row['califica'];
            $groups[$key]['puntos'] += $row['puntos'];
            $groups[$key]['participantes'][] = ['usuarioId' => $row['usuarioId'], 'nombre' => $names[$row['usuarioId']] ?? ('Vendedor ' . $row['usuarioId']), 'califica' => $row['califica'],
                'puntos' => $row['puntos'], 'motivo' => $row['motivo'], 'ventaMes' => $row['ventaMes'],
                'ventaCalificadoraMes' => $row['ventaCalificadoraMes'] ?? null];
            if ($row['motivo'] !== '') $groups[$key]['motivo'] = $row['motivo'];
        }
        return $groups;
    }

    private function evolutionDetail(array $query): array
    {
        $year = filter_var($query['anio'] ?? null, FILTER_VALIDATE_INT);
        $month = filter_var($query['mes'] ?? null, FILTER_VALIDATE_INT);
        $vendorId = filter_var($query['vendedorId'] ?? null, FILTER_VALIDATE_INT);
        $kind = $query['tipo'] ?? '';
        if (!$year || $year < 2000 || $year > (int)date('Y') + 1) throw new RuntimeException('Año no válido.', 400);
        if (!$month || $month < 1 || $month > 12) throw new RuntimeException('Mes no válido.', 400);
        if (!in_array($kind, ['nuevos', 'recuperados'], true)) throw new RuntimeException('Categoría no válida.', 400);
        $codes = [];
        $vendorName = '';
        foreach ($this->relations() as $relation) {
            if ((int)$relation['usuarioId'] !== $vendorId) continue;
            $codes[] = trim((string)$relation['codigoAsociado']);
            $vendorName = $relation['vendedor'];
        }
        if (!$codes) throw new RuntimeException('Vendedor no válido.', 400);
        $start = new DateTimeImmutable(sprintf('%04d-%02d-01', $year, $month));
        $data = $this->report(array_replace($query, ['desde' => $start->format('Y-m-d'),
            'hasta' => $start->modify('last day of this month')->format('Y-m-d'), 'vendedorId' => '']), false,
            ['kind' => $kind, 'codes' => array_values(array_unique($codes)), 'eventOnly' => true]);
        $clients = [];
        foreach ($data[$kind] as $event) {
            if (!in_array($vendorId, array_column($event['propietarios'], 'usuarioId'), true)) continue;
            $clients[] = ['codigo' => $event['codigoCliente'], 'cliente' => $event['cliente'], 'monto' => $this->eventAmount($event)];
        }
        usort($clients, static fn(array $a, array $b): int => ($b['monto'] <=> $a['monto']) ?: strnatcasecmp($a['cliente'], $b['cliente']));
        return ['ok' => true, 'anio' => $year, 'mes' => $month, 'tipo' => $kind, 'vendedor' => $vendorName,
            'cantidad' => count($clients), 'monto' => array_sum(array_column($clients, 'monto')), 'clientes' => $clients];
    }

    private function eventAmount(array $event): float
    {
        $amount = 0.0;
        foreach ($event['folios'] as $doc) {
            if (substr($doc['fecha'], 0, 7) === $event['periodo']) $amount += $doc['original'];
        }
        return $amount;
    }

    private function evolution(array $query): array
    {
        $year = filter_var($query['anio'] ?? date('Y'), FILTER_VALIDATE_INT);
        if (!$year || $year < 2000 || $year > (int)date('Y') + 1) throw new RuntimeException('Año no válido.', 400);
        $kind = $query['tipo'] ?? 'nuevos';
        if (!in_array($kind, ['nuevos', 'recuperados'], true)) throw new RuntimeException('Categoría no válida.', 400);
        $data = $this->report(array_replace($query, ['desde' => "$year-01-01", 'hasta' => "$year-12-31"]), false, ['eventOnly' => true]);
        $months = $vendors = [];
        foreach (range(1, 12) as $month) $months[$month] = ['mes' => $month, 'cantidad' => 0, 'venta' => 0.0];
        $emptyMonths = $months;
        foreach ($data[$kind] as $event) {
            $month = (int)substr($event['fecha'], 5, 2);
            $amount = $this->eventAmount($event);
            // Solo propietarios cwtauxven: nunca participantes ni importes atribuidos del Concurso.
            foreach ($event['propietarios'] as $owner) {
                $id = $owner['usuarioId'];
                $vendors[$id] ??= ['usuarioId' => $id, 'vendedor' => $owner['nombre'],
                    'cantidadAnual' => 0, 'montoAnual' => 0.0, 'meses' => $emptyMonths];
                $vendors[$id]['cantidadAnual']++;
                $vendors[$id]['meses'][$month]['cantidad']++;
                $vendors[$id]['meses'][$month]['venta'] += $amount;
                $vendors[$id]['montoAnual'] += $amount;
                // El gráfico es la suma de los mismos eventos por propietario del listado.
                $months[$month]['cantidad']++;
                $months[$month]['venta'] += $amount;
            }
        }
        foreach ($vendors as &$vendor) $vendor['meses'] = array_values($vendor['meses']);
        unset($vendor);
        uasort($vendors, static fn(array $a, array $b): int => strnatcasecmp($a['vendedor'], $b['vendedor']));
        return ['ok' => true, 'anio' => $year, 'tipo' => $kind, 'meses' => array_values($months), 'vendedores' => array_values($vendors)];
    }
}
