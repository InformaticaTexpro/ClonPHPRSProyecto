<?php
declare(strict_types=1);

final class AdquisicionesService
{
    use SharedServiceHelpers;

    private ?array $schema = null;
    public function __construct(private Database $db) {}

    public function route(array $payload, string $method, string $path, array $query): array
    {
        $this->currentUserIdFromPayload($payload);
        $allowed = (bool)($payload['is_admin'] ?? false);
        foreach (array_merge($payload['menus'] ?? [], $payload['menus_directos'] ?? []) as $menu) {
            if (($menu['codigo'] ?? '') === 'adquisiciones_control_oc') $allowed = true;
        }
        if (!$allowed) throw new RuntimeException('Sin acceso a Control de OC.', 403);
        if ($method !== 'GET') throw new RuntimeException('Método no permitido.', 405);
        return match ($path) {
            '/control-oc' => $this->controlOcResumen($query),
            '/control-oc/alerta' => $this->controlOcDetalle($query, true),
            '/control-oc/detalle' => $this->controlOcDetalle($query),
            '/control-oc/lineas' => $this->controlOcLineas($query),
            default => throw new RuntimeException('Ruta de Adquisiciones no encontrada.', 404),
        };
    }

    private function rows(string $sql, array $params = []): array
    {
        $stmt = $this->db->softland()->prepare($sql);
        $stmt->execute(array_values($params));
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    private function ocFilters(array $query): array
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
        $filters = ['desde' => $dates['desde']->format('Y-m-d'), 'hasta' => $dates['hasta']->format('Y-m-d'),
            'fin' => $dates['hasta']->modify('+1 day')->format('Y-m-d'), 'diasRango' => $dates['desde']->diff($dates['hasta'])->days + 1];
        foreach (['proveedor', 'centroCosto', 'estadoOC', 'estadoRecepcion'] as $key) {
            if (isset($query[$key]) && !is_string($query[$key])) throw new RuntimeException('Filtro ' . $key . ' inválido.', 400);
            $filters[$key] = trim((string)($query[$key] ?? ''));
            if (strlen($filters[$key]) > 80 || !preg_match('//u', $filters[$key])) throw new RuntimeException('Filtro ' . $key . ' inválido.', 400);
        }
        if (!in_array($filters['estadoOC'], ['', 'AP', 'PE', 'UN'], true)) throw new RuntimeException('Estado OC inválido.', 400);
        if (!in_array($filters['estadoRecepcion'], ['', 'SR', 'RP', 'RC'], true)) throw new RuntimeException('Estado de recepción inválido.', 400);
        return $filters;
    }

    // Variantes de nombres físicos se resuelven contra metadatos, nunca contra texto del usuario.
    private function column(string $table, array $candidates): string
    {
        if ($this->schema === null) {
            $this->schema = [];
            foreach ($this->rows("SELECT TABLE_NAME, COLUMN_NAME FROM [PRODIN].INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = 'softland' AND TABLE_NAME IN ('OWOrdenCom','OWGuiaDet','CWTCCOS')") as $row) {
                $this->schema[strtolower($row['TABLE_NAME'])][strtolower($row['COLUMN_NAME'])] = true;
            }
        }
        foreach ($candidates as $candidate) {
            if (isset($this->schema[strtolower($table)][strtolower($candidate)])) return '[' . $candidate . ']';
        }
        throw new RuntimeException('Esquema Softland no compatible: falta ' . $table . '.' . implode('/', $candidates) . '.', 500);
    }

    private function mbSql(string $value, string $stored, string $currency, string $rate): string
    {
        $calculated = "(COALESCE($value,0) * COALESCE($rate,0))";
        return "CASE WHEN $currency = '01' OR COALESCE($rate,0) = 0 THEN COALESCE($stored,0)
            WHEN 1.0 * ABS(COALESCE($stored,0) - $calculated) / NULLIF(ABS($calculated),0) > 0.01
            THEN $calculated ELSE COALESCE($stored,0) END";
    }

    private function ocBaseSql(array $filters, ?int $id = null): array
    {
        $headerValue = $this->column('OWOrdenCom', ['ValorTotOC', 'ValorTotal']);
        $headerMB = $this->column('OWOrdenCom', ['ValorTotMB', 'ValorTotalMB']);
        $guideQuantity = $this->column('OWGuiaDet', ['Cantidad', 'CantRecibida', 'CantRecep', 'CantRecepcion']);
        $ccName = $this->column('CWTCCOS', ['DescCC', 'DesCC', 'NomCC', 'Descripcion']);
        $headerValidated = $this->mbSql("h.$headerValue", "h.$headerMB", 'h.CodMon', 'h.EquivMonOC');
        $lineValidated = $this->mbSql('d.ValorTotal', 'd.ValorTotalMB', 'o.codMon', 'o.equivMonOC');
        $params = $id === null ? [$filters['desde'], $filters['fin']] : [$id];
        $where = $id === null ? 'h.FechaOC >= ? AND h.FechaOC < ?' : 'h.NumInterOC = ?';
        if ($id === null) foreach (['proveedor' => 'h.CodAux', 'centroCosto' => 'h.CodiCC', 'estadoOC' => 'h.CodEstado'] as $key => $field) {
            if ($filters[$key] !== '') { $where .= " AND $field = ?"; $params[] = $filters[$key]; }
        }
        $reception = '';
        if ($id === null && $filters['estadoRecepcion'] !== '') { $reception = ' WHERE estadoRecepcion = ?'; $params[] = $filters['estadoRecepcion']; }
        $period = $filters['diasRango'] <= 90 ? 'CONVERT(varchar(10), fechaOC, 23)' : "CONVERT(char(7), fechaOC, 23) + '-01'";
        $today = 'CONVERT(date, GETDATE())';
        // Recepciones limitadas a las OC candidatas; nunca se une el detalle sin agregar primero.
        $sql = "WITH OcRango AS (
            SELECT h.NumInterOC AS numInterOC, h.NumOC AS numOC, CONVERT(date,h.FechaOC) AS fechaOC,
                RTRIM(COALESCE(h.CodEstado,'')) AS codEstado, RTRIM(h.CodAux) AS codAux,
                COALESCE(NULLIF(RTRIM(a.NomAux),''),h.CodAux) AS proveedor, RTRIM(COALESCE(h.CodiCC,'')) AS codiCC,
                COALESCE(NULLIF(RTRIM(c.$ccName),''),NULLIF(RTRIM(h.CodiCC),''),'Sin centro de costo') AS centroCosto,
                RTRIM(h.CodMon) AS codMon, RTRIM(COALESCE(m.SimMon,h.CodMon)) AS simMon,
                COALESCE(h.EquivMonOC,0) AS equivMonOC, COALESCE(h.$headerValue,0) AS valorTotOC,
                $headerValidated AS valorTotMBValidado,
                CASE WHEN ($headerValidated) <> COALESCE(h.$headerMB,0) THEN 1 ELSE 0 END AS cabeceraMBRecalculada
            FROM [PRODIN].[softland].[OWOrdenCom] h
            LEFT JOIN [PRODIN].[softland].[CWTAuxi] a ON a.CodAux = h.CodAux
            LEFT JOIN [PRODIN].[softland].[CWTCCOS] c ON c.CodiCC = h.CodiCC
            LEFT JOIN [PRODIN].[softland].[CWTMone] m ON m.CodMon = h.CodMon WHERE $where
        ), Inventario AS (
            SELECT o.numInterOC, v.OcCorrela AS numLinea, v.CodProd COLLATE DATABASE_DEFAULT AS codProd,
                SUM(CASE WHEN g.Tipo = 'E' THEN COALESCE(v.CantIngresada,0) ELSE 0 END) AS entradaInventario,
                SUM(CASE WHEN g.Tipo = 'S' THEN COALESCE(v.CantDespachada,0) ELSE 0 END) AS devolucion
            FROM OcRango o INNER JOIN [PRODIN].[softland].[iw_gsaen] g ON g.Orden = o.numOC
            INNER JOIN [PRODIN].[softland].[iw_gmovi] v ON v.Tipo = g.Tipo AND v.NroInt = g.NroInt
            WHERE g.Estado = 'V' AND g.Orden > 0 AND ((g.Tipo = 'E' AND g.Concepto IN ('01','02')) OR (g.Tipo = 'S' AND g.Concepto = '05'))
            GROUP BY o.numInterOC, v.OcCorrela, v.CodProd COLLATE DATABASE_DEFAULT
        ), NoInventario AS (
            SELECT d.NumInterOC, d.NumLinea, d.CodProd COLLATE DATABASE_DEFAULT AS codProd, SUM(COALESCE(d.$guideQuantity,0)) AS recepcionNoInventariable
            FROM [PRODIN].[softland].[OWGuiaDet] d INNER JOIN [PRODIN].[softland].[OWGuiaRec] g ON g.NumInterG = d.NumInterG
            INNER JOIN OcRango o ON o.numInterOC = d.NumInterOC WHERE g.Estado = 'V'
            GROUP BY d.NumInterOC, d.NumLinea, d.CodProd COLLATE DATABASE_DEFAULT
        ), LineasBase AS (
            SELECT o.numInterOC, d.NumLinea AS numLinea, RTRIM(d.CodProd) AS codProd, LTRIM(RTRIM(CAST(d.DetProd AS nvarchar(max)))) AS descripcion,
                CONVERT(date,d.FechaEnt) AS fechaEnt, COALESCE(d.Cantidad,0) AS cantidadOrdenada,
                COALESCE(d.RecepManual,0) AS recepManual, COALESCE(i.entradaInventario,0) AS entradaInventario,
                COALESCE(i.devolucion,0) AS devolucion, COALESCE(r.recepcionNoInventariable,0) AS recepcionNoInventariable,
                COALESCE(d.RecepManual,0) + COALESCE(i.entradaInventario,0) - COALESCE(i.devolucion,0) + COALESCE(r.recepcionNoInventariable,0) AS recibidoReal,
                COALESCE(d.ValorTotal,0) AS valorTotalMonedaOC, $lineValidated AS valorTotalMBValidado,
                CASE WHEN ($lineValidated) <> COALESCE(d.ValorTotalMB,0) THEN 1 ELSE 0 END AS lineaMBRecalculada
            FROM [PRODIN].[softland].[OWOrdenDet] d INNER JOIN OcRango o ON o.numInterOC = d.NumInterOC
            LEFT JOIN Inventario i ON i.numInterOC = d.NumInterOC AND i.numLinea = d.NumLinea AND i.codProd = d.CodProd COLLATE DATABASE_DEFAULT
            LEFT JOIN NoInventario r ON r.NumInterOC = d.NumInterOC AND r.NumLinea = d.NumLinea AND r.codProd = d.CodProd COLLATE DATABASE_DEFAULT
        ), LineasSaldo AS (
            SELECT *, CASE WHEN ABS(cantidadOrdenada - recibidoReal) < 0.0001 THEN 0 ELSE cantidadOrdenada - recibidoReal END AS saldoReal FROM LineasBase
        ), LineasFactor AS (
            SELECT *, CASE WHEN saldoReal <= 0.0001 OR cantidadOrdenada <= 0 THEN 0.0
                WHEN saldoReal >= cantidadOrdenada THEN 1.0 ELSE 1.0 * saldoReal / NULLIF(cantidadOrdenada,0) END AS factorPendiente FROM LineasSaldo
        ), Lineas AS (
            SELECT *, factorPendiente * valorTotalMonedaOC AS montoPendienteMonedaOC,
                factorPendiente * valorTotalMBValidado AS montoPendienteNetoMB,
                CASE WHEN saldoReal > 0.0001 AND fechaEnt < $today THEN factorPendiente * valorTotalMBValidado ELSE 0 END AS montoVencidoNetoMB,
                CASE WHEN saldoReal > 0.0001 AND fechaEnt < $today THEN DATEDIFF(DAY,fechaEnt,$today) ELSE 0 END AS diasAtraso,
                CASE WHEN saldoReal < -0.0001 THEN 1 ELSE 0 END AS tieneSobreRecepcion,
                CASE WHEN saldoReal > 0.0001 AND fechaEnt >= $today AND fechaEnt < DATEADD(DAY,8,$today) THEN 1 ELSE 0 END AS proxima7,
                CASE WHEN saldoReal > 0.0001 AND fechaEnt IS NULL THEN 1 ELSE 0 END AS sinFecha,
                CASE WHEN saldoReal < -0.0001 THEN 'COMPLETA' WHEN recibidoReal <= 0.0001 THEN 'SIN_RECEPCION'
                    WHEN saldoReal > 0.0001 THEN 'PENDIENTE' ELSE 'COMPLETA' END AS estadoLinea
            FROM LineasFactor
        ), ResumenLineas AS (
            SELECT numInterOC, COUNT_BIG(*) AS cantidadLineas, MAX(CASE WHEN recibidoReal > 0.0001 THEN 1 ELSE 0 END) AS tieneRecepcion,
                SUM(CASE WHEN saldoReal > 0.0001 THEN 1 ELSE 0 END) AS lineasPendientes,
                SUM(CASE WHEN diasAtraso > 0 THEN 1 ELSE 0 END) AS lineasVencidas,
                SUM(montoPendienteMonedaOC) AS montoPendienteNetoMonedaOC, SUM(montoPendienteNetoMB) AS montoPendienteNetoMB,
                SUM(montoVencidoNetoMB) AS montoVencidoNetoMB, MAX(diasAtraso) AS maxDiasAtraso,
                MIN(CASE WHEN saldoReal > 0.0001 THEN fechaEnt END) AS fechaPendienteMasAntigua,
                MIN(CASE WHEN saldoReal > 0.0001 AND fechaEnt >= $today THEN fechaEnt END) AS proximaEntrega,
                SUM(tieneSobreRecepcion) AS lineasSobreRecibidas,
                SUM(CASE WHEN saldoReal < -0.0001 THEN -saldoReal ELSE 0 END) AS cantidadSobreRecibida,
                MAX(proxima7) AS tieneEntregaProxima7Dias, MAX(sinFecha) AS tienePendienteSinFecha,
                MAX(lineaMBRecalculada) AS lineaMBRecalculada FROM Lineas GROUP BY numInterOC
        ), Ordenes AS (
            SELECT o.*, CASE o.codEstado WHEN 'AP' THEN 'Aprobada' WHEN 'PE' THEN 'Pendiente' WHEN 'UN' THEN 'Nula' ELSE 'Otro estado' END AS estadoOC,
                CASE WHEN o.codEstado <> 'AP' THEN 'NA' WHEN r.cantidadLineas IS NULL THEN 'SD'
                    WHEN r.tieneRecepcion = 0 THEN 'SR' WHEN r.lineasPendientes > 0 THEN 'RP' ELSE 'RC' END AS estadoRecepcion,
                COALESCE(r.cantidadLineas,0) AS cantidadLineas, r.fechaPendienteMasAntigua, r.proximaEntrega,
                CASE WHEN o.codEstado = 'AP' THEN COALESCE(r.montoPendienteNetoMonedaOC,0) ELSE 0 END AS montoPendienteNetoMonedaOC,
                CASE WHEN o.codEstado = 'AP' THEN COALESCE(r.montoPendienteNetoMB,0) ELSE 0 END AS montoPendienteNetoMB,
                CASE WHEN o.codEstado = 'AP' THEN COALESCE(r.montoVencidoNetoMB,0) ELSE 0 END AS montoVencidoNetoMB,
                CASE WHEN o.codEstado = 'AP' THEN COALESCE(r.maxDiasAtraso,0) ELSE 0 END AS maxDiasAtraso,
                CASE WHEN o.codEstado = 'AP' THEN COALESCE(r.lineasVencidas,0) ELSE 0 END AS lineasVencidas,
                CASE WHEN o.codEstado = 'AP' AND r.lineasSobreRecibidas > 0 THEN 1 ELSE 0 END AS tieneSobreRecepcion,
                CASE WHEN o.codEstado = 'AP' THEN COALESCE(r.lineasSobreRecibidas,0) ELSE 0 END AS lineasSobreRecibidas,
                CASE WHEN o.codEstado = 'AP' THEN COALESCE(r.cantidadSobreRecibida,0) ELSE 0 END AS cantidadSobreRecibida,
                CASE WHEN o.codEstado = 'AP' THEN COALESCE(r.tieneEntregaProxima7Dias,0) ELSE 0 END AS tieneEntregaProxima7Dias,
                CASE WHEN o.codEstado = 'AP' THEN COALESCE(r.tienePendienteSinFecha,0) ELSE 0 END AS tienePendienteSinFecha,
                CASE WHEN o.cabeceraMBRecalculada = 1 OR r.lineaMBRecalculada = 1 THEN 1 ELSE 0 END AS tieneCorreccionMonedaBase
            FROM OcRango o LEFT JOIN ResumenLineas r ON r.numInterOC = o.numInterOC
        ), Filtradas AS (
            SELECT *, $period AS periodo, CASE WHEN maxDiasAtraso BETWEEN 1 AND 7 THEN '1-7'
                WHEN maxDiasAtraso BETWEEN 8 AND 15 THEN '8-15' WHEN maxDiasAtraso BETWEEN 16 AND 30 THEN '16-30'
                WHEN maxDiasAtraso BETWEEN 31 AND 60 THEN '31-60' WHEN maxDiasAtraso > 60 THEN '>60' ELSE '' END AS segmentoAntiguedad
            FROM Ordenes $reception
        )";
        return [$sql, $params];
    }

    private function controlOcResumen(array $query): array
    {
        $filters = $this->ocFilters($query);
        [$base, $params] = $this->ocBaseSql($filters);
        // Una agregación por conjuntos produce estados, evolución y rankings, no filas de OC.
        $rows = $this->rows($base . " SELECT CASE WHEN GROUPING(codEstado) = 0 THEN 'estado'
            WHEN GROUPING(periodo) = 0 THEN 'evolucion' WHEN GROUPING(codAux) = 0 THEN 'proveedor'
            WHEN GROUPING(codiCC) = 0 THEN 'centro' ELSE 'antiguedad' END AS tipo,
            codEstado, estadoRecepcion, periodo, codAux, proveedor, codiCC, centroCosto, segmentoAntiguedad,
            COUNT_BIG(*) AS cantidad, SUM(valorTotMBValidado) AS montoBaseValidado,
            SUM(CASE WHEN codEstado = 'AP' THEN 1 ELSE 0 END) AS aprobadas,
            SUM(CASE WHEN codEstado = 'AP' THEN valorTotMBValidado ELSE 0 END) AS montoAprobadoBase,
            SUM(montoPendienteNetoMB) AS montoPendienteNetoMB, SUM(montoVencidoNetoMB) AS montoVencidoNetoMB,
            SUM(CASE WHEN estadoRecepcion IN ('SR','RP') THEN 1 ELSE 0 END) AS cantidadAbiertas,
            SUM(CASE WHEN estadoRecepcion IN ('SR','RP') THEN montoPendienteNetoMB ELSE 0 END) AS pendienteAbiertas,
            SUM(CASE WHEN maxDiasAtraso > 0 THEN 1 ELSE 0 END) AS vencidas,
            MAX(maxDiasAtraso) AS maxDiasAtraso,
            MIN(CASE WHEN estadoRecepcion IN ('SR','RP') THEN fechaOC END) AS ocPendienteMasAntigua,
            SUM(tieneEntregaProxima7Dias) AS proximas7,
            SUM(CASE WHEN tieneEntregaProxima7Dias = 1 THEN montoPendienteNetoMB ELSE 0 END) AS montoProximas7,
            SUM(tieneSobreRecepcion) AS sobreRecepcion, SUM(lineasSobreRecibidas) AS lineasSobreRecibidas,
            SUM(cantidadSobreRecibida) AS cantidadSobreRecibida, SUM(tienePendienteSinFecha) AS sinFecha,
            SUM(CASE WHEN tienePendienteSinFecha = 1 THEN montoPendienteNetoMB ELSE 0 END) AS montoSinFecha,
            SUM(tieneCorreccionMonedaBase) AS correccionesMB
            FROM Filtradas GROUP BY GROUPING SETS ((codEstado,estadoRecepcion),(periodo),(codAux,proveedor),(codiCC,centroCosto),(segmentoAntiguedad))", $params);
        $empty = ['cantidad' => 0, 'montoBaseValidado' => 0.0];
        $kpis = array_fill_keys(['emitidas', 'aprobadas', 'pendientes', 'nulas', 'otrosEstados'], $empty);
        $receptionEmpty = ['cantidad' => 0, 'montoPendienteNetoMB' => 0.0, 'montoVencidoNetoMB' => 0.0, 'porcentajeAprobadas' => 0.0];
        $reception = array_fill_keys(['SR', 'RP', 'RC', 'SD', 'abiertas'], $receptionEmpty);
        $alerts = ['vencidas' => ['cantidad' => 0, 'montoVencidoNetoMB' => 0.0, 'maxDiasAtraso' => 0],
            'proximas_7' => ['cantidad' => 0, 'montoPendienteNetoMB' => 0.0],
            'sobrerrecepcion' => ['cantidad' => 0, 'cantidadOC' => 0, 'cantidadLineas' => 0, 'cantidadSobreRecibida' => 0.0],
            'sin_fecha' => ['cantidad' => 0, 'montoPendienteNetoMB' => 0.0]];
        $aging = [];
        foreach (['1-7', '8-15', '16-30', '31-60', '>60'] as $code) $aging[$code] = ['codigo' => $code, 'nombre' => $code . ' días', 'cantidad' => 0, 'montoVencidoNetoMB' => 0.0];
        $evolution = $suppliers = $centers = [];
        $pending = $overdue = 0.0;
        $oldest = null;
        $corrections = 0;
        foreach ($rows as $row) {
            if ($row['tipo'] === 'estado') {
                $key = match ($row['codEstado']) { 'AP' => 'aprobadas', 'PE' => 'pendientes', 'UN' => 'nulas', default => 'otrosEstados' };
                foreach (['emitidas', $key] as $k) { $kpis[$k]['cantidad'] += (int)$row['cantidad']; $kpis[$k]['montoBaseValidado'] += (float)$row['montoBaseValidado']; }
                if ($row['codEstado'] === 'AP') {
                    $state = $row['estadoRecepcion'];
                    if (!isset($reception[$state])) throw new RuntimeException('Estado de recepción inconsistente.', 500);
                    $reception[$state]['cantidad'] += (int)$row['cantidad'];
                    $reception[$state]['montoPendienteNetoMB'] += (float)$row['montoPendienteNetoMB'];
                    $reception[$state]['montoVencidoNetoMB'] += (float)$row['montoVencidoNetoMB'];
                }
                $pending += (float)$row['montoPendienteNetoMB']; $overdue += (float)$row['montoVencidoNetoMB'];
                $alerts['vencidas']['cantidad'] += (int)$row['vencidas'];
                $alerts['vencidas']['montoVencidoNetoMB'] += (float)$row['montoVencidoNetoMB'];
                $alerts['vencidas']['maxDiasAtraso'] = max($alerts['vencidas']['maxDiasAtraso'], (int)$row['maxDiasAtraso']);
                $alerts['proximas_7']['cantidad'] += (int)$row['proximas7']; $alerts['proximas_7']['montoPendienteNetoMB'] += (float)$row['montoProximas7'];
                $alerts['sobrerrecepcion']['cantidad'] += (int)$row['sobreRecepcion'];
                $alerts['sobrerrecepcion']['cantidadOC'] += (int)$row['sobreRecepcion'];
                $alerts['sobrerrecepcion']['cantidadLineas'] += (int)$row['lineasSobreRecibidas'];
                $alerts['sobrerrecepcion']['cantidadSobreRecibida'] += (float)$row['cantidadSobreRecibida'];
                $alerts['sin_fecha']['cantidad'] += (int)$row['sinFecha']; $alerts['sin_fecha']['montoPendienteNetoMB'] += (float)$row['montoSinFecha'];
                if ($row['ocPendienteMasAntigua'] !== null) $oldest = $oldest === null ? $row['ocPendienteMasAntigua'] : min($oldest, $row['ocPendienteMasAntigua']);
                $corrections += (int)$row['correccionesMB'];
            } elseif ($row['tipo'] === 'evolucion') {
                $evolution[] = ['periodo' => $row['periodo'], 'emitidas' => (int)$row['cantidad'], 'aprobadas' => (int)$row['aprobadas'],
                    'montoEmitidoBase' => (float)$row['montoBaseValidado'], 'montoAprobadoBase' => (float)$row['montoAprobadoBase']];
            } elseif ($row['tipo'] === 'antiguedad' && isset($aging[$row['segmentoAntiguedad']])) {
                $aging[$row['segmentoAntiguedad']]['cantidad'] = (int)$row['vencidas'];
                $aging[$row['segmentoAntiguedad']]['montoVencidoNetoMB'] = (float)$row['montoVencidoNetoMB'];
            } elseif (in_array($row['tipo'], ['proveedor', 'centro'], true) && (int)$row['cantidadAbiertas'] > 0) {
                $rank = ['nombre' => $row['tipo'] === 'proveedor' ? $row['proveedor'] : $row['centroCosto'], 'cantidadOC' => (int)$row['cantidadAbiertas'],
                    'montoPendienteNetoMB' => (float)$row['pendienteAbiertas'], 'montoVencidoNetoMB' => (float)$row['montoVencidoNetoMB'], 'maxDiasAtraso' => (int)$row['maxDiasAtraso']];
                if ($row['tipo'] === 'proveedor') $suppliers[] = ['codAux' => $row['codAux']] + $rank;
                else $centers[] = ['codiCC' => $row['codiCC']] + $rank;
            }
        }
        foreach (['cantidad', 'montoPendienteNetoMB', 'montoVencidoNetoMB'] as $key) $reception['abiertas'][$key] = $reception['SR'][$key] + $reception['RP'][$key];
        foreach ($reception as &$state) $state['porcentajeAprobadas'] = $kpis['aprobadas']['cantidad'] ? 100 * $state['cantidad'] / $kpis['aprobadas']['cantidad'] : 0;
        unset($state);
        $checks = [
            'estadosOC' => $kpis['emitidas']['cantidad'] === array_sum(array_column(array_diff_key($kpis, ['emitidas' => true]), 'cantidad')),
            'recepcion' => $kpis['aprobadas']['cantidad'] === $reception['SR']['cantidad'] + $reception['RP']['cantidad'] + $reception['RC']['cantidad'] + $reception['SD']['cantidad']
                && $reception['abiertas']['cantidad'] === $reception['SR']['cantidad'] + $reception['RP']['cantidad'],
            'vencidas' => array_sum(array_column($aging, 'cantidad')) === $alerts['vencidas']['cantidad'] && abs(array_sum(array_column($aging, 'montoVencidoNetoMB')) - $overdue) < .05,
            'montos' => $overdue <= $pending + .05,
        ];
        if (in_array(false, $checks, true)) throw new RuntimeException('Los totales de Control de OC no concilian. No se muestran resultados inconsistentes.', 500);
        usort($evolution, static fn(array $a, array $b): int => strcmp($a['periodo'], $b['periodo']));
        $sort = static fn(array $a, array $b): int => ($b['montoPendienteNetoMB'] <=> $a['montoPendienteNetoMB']) ?: strnatcasecmp($a['nombre'], $b['nombre']);
        usort($suppliers, $sort); usort($centers, $sort);
        $receptionChart = [];
        foreach (['RC' => 'Completa', 'RP' => 'Parcial', 'SR' => 'Sin recepción'] as $code => $name) $receptionChart[] = ['estado' => $code, 'nombre' => $name] + $reception[$code];
        return ['ok' => true, 'filtros' => array_diff_key($filters, ['fin' => true]), 'kpis' => $kpis, 'recepcion' => $reception, 'alertas' => $alerts,
            'finanzas' => ['montoPendienteNetoMB' => $pending, 'montoVencidoNetoMB' => $overdue, 'montoPendienteEnPlazoMB' => $pending - $overdue,
                'porcentajePendienteVencido' => $pending != 0 ? 100 * $overdue / $pending : 0],
            'indicadores' => ['ocPendienteMasAntigua' => $oldest, 'maxDiasAtraso' => $alerts['vencidas']['maxDiasAtraso'],
                'montoPendientePromedio' => $reception['abiertas']['cantidad'] ? $pending / $reception['abiertas']['cantidad'] : 0,
                'porcentajeRecepcionCompleta' => $reception['RC']['porcentajeAprobadas'], 'ocConCorreccionMonedaBase' => $corrections],
            'evolucion' => $evolution, 'agrupacion' => $filters['diasRango'] <= 90 ? 'diaria' : 'mensual', 'estadoRecepcion' => $receptionChart,
            'antiguedadVencida' => array_values($aging), 'rankingProveedores' => array_slice($suppliers, 0, 10), 'rankingCentrosCosto' => $centers,
            'conciliaciones' => $checks, 'opciones' => ($query['incluirOpciones'] ?? '') === '1' ? $this->ocOpciones($filters) : null];
    }

    private function ocOpciones(array $filters): array
    {
        $ccName = $this->column('CWTCCOS', ['DescCC', 'DesCC', 'NomCC', 'Descripcion']);
        $rows = $this->rows("SELECT 'proveedor' AS tipo, RTRIM(h.CodAux) AS codigo, MAX(COALESCE(NULLIF(RTRIM(a.NomAux),''),h.CodAux)) AS nombre
            FROM [PRODIN].[softland].[OWOrdenCom] h LEFT JOIN [PRODIN].[softland].[CWTAuxi] a ON a.CodAux = h.CodAux
            WHERE h.FechaOC >= ? AND h.FechaOC < ? AND h.CodAux IS NOT NULL GROUP BY h.CodAux
            UNION ALL SELECT 'centro' AS tipo, RTRIM(h.CodiCC) AS codigo, MAX(COALESCE(NULLIF(RTRIM(c.$ccName),''),h.CodiCC)) AS nombre
            FROM [PRODIN].[softland].[OWOrdenCom] h LEFT JOIN [PRODIN].[softland].[CWTCCOS] c ON c.CodiCC = h.CodiCC
            WHERE h.FechaOC >= ? AND h.FechaOC < ? AND h.CodiCC IS NOT NULL GROUP BY h.CodiCC", [$filters['desde'], $filters['fin'], $filters['desde'], $filters['fin']]);
        $options = ['proveedores' => [], 'centrosCosto' => [], 'estadosOC' => ['AP', 'PE', 'UN'], 'estadosRecepcion' => ['SR', 'RP', 'RC']];
        foreach ($rows as $row) if (trim((string)$row['codigo']) !== '') $options[$row['tipo'] === 'proveedor' ? 'proveedores' : 'centrosCosto'][] = ['codigo' => $row['codigo'], 'nombre' => $row['nombre']];
        foreach (['proveedores', 'centrosCosto'] as $key) usort($options[$key], static fn(array $a, array $b): int => strnatcasecmp($a['nombre'], $b['nombre']));
        return $options;
    }

    private function controlOcDetalle(array $query, bool $alert = false): array
    {
        $filters = $this->ocFilters($query);
        [$base, $params] = $this->ocBaseSql($filters);
        $where = '';
        if ($alert) $where = ' WHERE ' . match ($query['tipo'] ?? '') {
            'sin_recepcion' => "estadoRecepcion = 'SR'", 'parcial' => "estadoRecepcion = 'RP'", 'completa' => "estadoRecepcion = 'RC'",
            'abiertas' => "estadoRecepcion IN ('SR','RP')", 'vencidas' => 'maxDiasAtraso > 0', 'proximas_7' => 'tieneEntregaProxima7Dias = 1',
            'sobrerrecepcion' => 'tieneSobreRecepcion = 1', 'sin_fecha' => 'tienePendienteSinFecha = 1',
            default => throw new RuntimeException('Alerta no válida.', 400),
        };
        $page = filter_var($query['pagina'] ?? 1, FILTER_VALIDATE_INT);
        if (!$page || $page < 1 || $page > 10000000) throw new RuntimeException('Página no válida.', 400);
        $totals = $this->rows($base . " SELECT COUNT_BIG(*) AS cantidad, COALESCE(SUM(montoPendienteNetoMB),0) AS montoPendienteNetoMB,
            COALESCE(SUM(montoVencidoNetoMB),0) AS montoVencidoNetoMB FROM Filtradas $where", $params)[0];
        $orders = $this->rows($base . " SELECT numInterOC, numOC, CONVERT(varchar(10),fechaOC,23) AS fechaOC, codEstado, estadoOC, codAux, proveedor,
            codiCC, centroCosto, codMon, simMon, equivMonOC, valorTotOC, valorTotMBValidado, estadoRecepcion,
            CONVERT(varchar(10),fechaPendienteMasAntigua,23) AS fechaPendienteMasAntigua,
            CONVERT(varchar(10),proximaEntrega,23) AS proximaEntrega, maxDiasAtraso, montoPendienteNetoMonedaOC, montoPendienteNetoMB, montoVencidoNetoMB,
            tieneSobreRecepcion, tieneEntregaProxima7Dias, tienePendienteSinFecha FROM Filtradas $where
            ORDER BY fechaOC DESC, numOC DESC, numInterOC DESC OFFSET CAST(? AS int) ROWS FETCH NEXT CAST(? AS int) ROWS ONLY",
            array_merge($params, [($page - 1) * 100, 100]));
        return ['ok' => true, 'cantidad' => (int)$totals['cantidad'], 'montoPendienteNetoMB' => (float)$totals['montoPendienteNetoMB'],
            'montoVencidoNetoMB' => (float)$totals['montoVencidoNetoMB'], 'pagina' => $page, 'tamanoPagina' => 100,
            'hayMas' => $page * 100 < (int)$totals['cantidad'], 'ordenes' => array_map([$this, 'castOrder'], $orders)];
    }

    private function castOrder(array $row): array
    {
        foreach (['numInterOC', 'numOC', 'maxDiasAtraso', 'cantidadLineas', 'lineasSobreRecibidas', 'lineasVencidas'] as $key) if (isset($row[$key])) $row[$key] = (int)$row[$key];
        foreach (['equivMonOC', 'valorTotOC', 'valorTotMBValidado', 'montoPendienteNetoMonedaOC', 'montoPendienteNetoMB', 'montoVencidoNetoMB', 'cantidadSobreRecibida'] as $key) if (isset($row[$key])) $row[$key] = (float)$row[$key];
        foreach (['tieneSobreRecepcion', 'tieneEntregaProxima7Dias', 'tienePendienteSinFecha', 'cabeceraMBRecalculada', 'tieneCorreccionMonedaBase'] as $key) if (isset($row[$key])) $row[$key] = (bool)$row[$key];
        return $row;
    }

    private function controlOcLineas(array $query): array
    {
        $id = filter_var($query['numInterOC'] ?? null, FILTER_VALIDATE_INT);
        if (!$id || $id < 1) throw new RuntimeException('Identificador interno OC inválido.', 400);
        $filters = $this->ocFilters([]);
        [$base, $params] = $this->ocBaseSql($filters, $id);
        $header = $this->rows($base . ' SELECT * FROM Filtradas', $params)[0] ?? null;
        if (!$header) throw new RuntimeException('Orden de Compra no encontrada.', 404);
        $lines = $this->rows($base . ' SELECT * FROM Lineas ORDER BY numLinea', $params);
        foreach ($lines as &$line) {
            foreach (['cantidadOrdenada', 'recepManual', 'entradaInventario', 'devolucion', 'recepcionNoInventariable', 'recibidoReal', 'saldoReal',
                'valorTotalMonedaOC', 'valorTotalMBValidado', 'montoPendienteMonedaOC', 'montoPendienteNetoMB', 'montoVencidoNetoMB'] as $key) $line[$key] = (float)$line[$key];
            $line['numLinea'] = (int)$line['numLinea']; $line['diasAtraso'] = (int)$line['diasAtraso'];
            $line['tieneSobreRecepcion'] = (bool)$line['tieneSobreRecepcion']; $line['lineaMBRecalculada'] = (bool)$line['lineaMBRecalculada'];
        }
        unset($line);
        return ['ok' => true, 'cabecera' => $this->castOrder($header), 'lineas' => $lines];
    }
}
