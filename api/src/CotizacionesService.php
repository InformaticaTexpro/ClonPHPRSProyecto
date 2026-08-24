<?php
declare(strict_types=1);

final class CotizacionesService
{
    use SharedServiceHelpers;

    public function __construct(private Database $db)
    {
    }

    public function route(array $payload, string $method, string $path, array $query, array $body): array
    {
        return match (true) {
            $method === 'GET' && $path === '/' => $this->listado($payload, $query),
            $method === 'GET' && $path === '/resumen' => $this->resumen($payload, $query),
            $method === 'GET' && $path === '/filtros' => $this->filtros($payload, $query),
            $method === 'GET' && preg_match('#^/detalle/(\d+)$#', $path, $m) => $this->detalle((int)$m[1], $payload),
            default => throw new RuntimeException('Ruta de cotizaciones no encontrada', 404),
        };
    }

    private function normalizeArea(mixed $value): string
    {
        $text = trim((string)$value);
        $text = mb_strtolower($text);
        $text = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $text) ?: $text;
        $text = preg_replace('/\s+/', '-', $text) ?? $text;
        $text = preg_replace('/[^a-z0-9-]/', '', $text) ?? $text;
        return trim($text, '-');
    }

    private function hasGlobalScope(array $payload): bool
    {
        if ((bool)($payload['is_admin'] ?? false)) {
            return true;
        }

        $area = $this->normalizeArea($payload['area'] ?? '');
        return in_array($area, ['gerencia', 'admin', 'administracion'], true);
    }

    private function userVendorCodes(array $payload): array
    {
        return $this->vendorCodesFromUserId($this->currentUserIdFromPayload($payload));
    }

    private function vendorFilterSql(array $codes, array &$params, string $column = 'c.VenCod'): string
    {
        if (!$codes) {
            return '1=0';
        }

        foreach ($codes as $code) {
            $params[] = $code;
        }

        return 'LTRIM(RTRIM(' . $column . ')) IN (' . implode(',', array_fill(0, count($codes), '?')) . ')';
    }

    private function vendorAccessWhere(array $payload, array $query, array &$params): string
    {
        $codes = $this->userVendorCodes($payload);
        if (!$codes) {
            return '1=0';
        }

        $selectedVendor = trim((string)($query['vendedor'] ?? $query['cod_vendedor'] ?? ''));
        if ($selectedVendor !== '') {
            $selectedVendor = Security::validate_cod_vendedor($selectedVendor);
            if (!in_array($selectedVendor, $codes, true)) {
                return '1=0';
            }

            $params[] = $selectedVendor;
            return 'LTRIM(RTRIM(c.VenCod)) = ?';
        }

        return $this->vendorFilterSql($codes, $params);
    }

    private function escapedLike(string $value): string
    {
        return str_replace(['\\', '%', '_', '['], ['\\\\', '\\%', '\\_', '\\['], $value);
    }

    private function softlandOne(string $sql, array $params = []): ?array
    {
        $stmt = $this->softland()->prepare($sql);
        $index = 1;
        foreach (array_values($params) as $value) {
            if (is_int($value)) {
                $stmt->bindValue($index, $value, PDO::PARAM_INT);
            } elseif ($value === null) {
                $stmt->bindValue($index, null, PDO::PARAM_NULL);
            } else {
                $stmt->bindValue($index, (string)$value, PDO::PARAM_STR);
            }
            $index += 1;
        }
        $stmt->execute();
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    private function softlandAll(string $sql, array $params = []): array
    {
        $stmt = $this->softland()->prepare($sql);
        $index = 1;
        foreach (array_values($params) as $value) {
            if (is_int($value)) {
                $stmt->bindValue($index, $value, PDO::PARAM_INT);
            } elseif ($value === null) {
                $stmt->bindValue($index, null, PDO::PARAM_NULL);
            } else {
                $stmt->bindValue($index, (string)$value, PDO::PARAM_STR);
            }
            $index += 1;
        }
        $stmt->execute();
        return $stmt->fetchAll();
    }

    private function currentScope(array $query): string
    {
        $scope = mb_strtolower(trim((string)($query['scope'] ?? 'month')));
        return in_array($scope, ['month', 'mes', 'actual', 'current'], true) ? 'month' : 'all';
    }

    private function buildFilters(array $payload, array $query, string $scope, array &$params): string
    {
        $conditions = [];

        $mesAnio = $this->monthYear($query);
        if ($scope === 'month') {
            $conditions[] = 'c.CtFem >= ?';
            $conditions[] = 'c.CtFem < ?';
            $params[] = $this->monthStart($mesAnio['anio'], $mesAnio['mes']);
            $params[] = (new DateTimeImmutable($this->monthStart($mesAnio['anio'], $mesAnio['mes'])))->modify('+1 month')->format('Y-m-d');
        }

        $conditions[] = $this->vendorAccessWhere($payload, $query, $params);

        $estado = trim((string)($query['estado'] ?? ''));
        if ($estado !== '') {
            $conditions[] = 'LTRIM(RTRIM(c.CtEstado)) = ?';
            $params[] = $estado;
        }

        $numero = trim((string)($query['cotizacion'] ?? $query['numero'] ?? ''));
        if ($numero !== '') {
            $numero = preg_replace('/[^0-9]/', '', $numero) ?? '';
            if ($numero !== '') {
                $conditions[] = 'CAST(c.CotNum AS varchar(30)) LIKE ?';
                $params[] = '%' . $numero . '%';
            }
        }

        $cliente = trim((string)($query['cliente'] ?? $query['q'] ?? ''));
        if ($cliente !== '') {
            $like = '%' . $this->escapedLike($cliente) . '%';
            $conditions[] = '(c.CodAux LIKE ? OR c.NomCon LIKE ?)';
            $params[] = $like;
            $params[] = $like;
        }

        return implode(' AND ', $conditions);
    }

    private function baseFromClause(): string
    {
        return "FROM [PRODIN].[softland].[nwcotiza] c
                LEFT JOIN [PRODIN].[softland].[cwtvend] v ON v.VenCod = c.VenCod";
    }

    private function itemsSubquery(): string
    {
        return "(SELECT CotNum, COUNT(*) AS items
                   FROM [PRODIN].[softland].[nwdetcot]
                  GROUP BY CotNum) d";
    }

    private function mapRow(array $row): array
    {
        return [
            'CotNum' => (int)($row['CotNum'] ?? 0),
            'fecha_formato' => substr((string)($row['fecha_formato'] ?? ''), 0, 10),
            'CodAux' => trim((string)($row['CodAux'] ?? '')),
            'NomCon' => trim((string)($row['NomCon'] ?? '')),
            'VenCod' => trim((string)($row['VenCod'] ?? '')),
            'vendedor_nombre' => trim((string)($row['vendedor_nombre'] ?? '')),
            'CtEstado' => trim((string)($row['CtEstado'] ?? '')),
            'CtSubTotal' => (float)($row['CtSubTotal'] ?? 0),
            'CtTotalDesc' => (float)($row['CtTotalDesc'] ?? 0),
            'CtNetoExento' => (float)($row['CtNetoExento'] ?? 0),
            'CtNetoAfecto' => (float)($row['CtNetoAfecto'] ?? 0),
            'CtMonto' => (float)($row['CtMonto'] ?? 0),
            'items' => (int)($row['items'] ?? 0),
        ];
    }

    private function fetchPage(array $payload, array $query, string $scope, int $limit, int $offset): array
    {
        $params = [];
        $where = $this->buildFilters($payload, $query, $scope, $params);

        if ($where === '1=0') {
            return ['total' => 0, 'rows' => [], 'totals' => ['subtotal' => 0, 'descuento' => 0, 'neto_exento' => 0, 'neto_afecto' => 0, 'monto' => 0]];
        }

        $countSql = "SELECT
                        COUNT(DISTINCT c.CotNum) AS total,
                        COALESCE(SUM(ISNULL(c.CtSubTotal, 0)), 0) AS subtotal,
                        COALESCE(SUM(ISNULL(c.CtTotalDesc, 0)), 0) AS descuento,
                        COALESCE(SUM(ISNULL(c.CtNetoExento, 0)), 0) AS neto_exento,
                        COALESCE(SUM(ISNULL(c.CtNetoAfecto, 0)), 0) AS neto_afecto,
                        COALESCE(SUM(ISNULL(c.CtMonto, 0)), 0) AS monto
                     " . $this->baseFromClause() . "
                     WHERE {$where}";
        $summary = $this->softlandOne($countSql, $params) ?: [];

        $rowSql = "SELECT
                    c.CotNum,
                    CONVERT(varchar(10), c.CtFem, 120) AS fecha_formato,
                    LTRIM(RTRIM(COALESCE(NULLIF(LTRIM(RTRIM(CONVERT(varchar(max), c.CodAux))), ''), ''))) AS CodAux,
                    COALESCE(NULLIF(LTRIM(RTRIM(CONVERT(varchar(max), c.NomCon))), ''), LTRIM(RTRIM(c.CodAux))) AS NomCon,
                    LTRIM(RTRIM(COALESCE(c.VenCod, ''))) AS VenCod,
                    COALESCE(NULLIF(LTRIM(RTRIM(CONVERT(varchar(max), v.VenDes))), ''), LTRIM(RTRIM(c.VenCod))) AS vendedor_nombre,
                    LTRIM(RTRIM(COALESCE(c.CtEstado, ''))) AS CtEstado,
                    CAST(ISNULL(c.CtSubTotal, 0) AS FLOAT) AS CtSubTotal,
                    CAST(ISNULL(c.CtTotalDesc, 0) AS FLOAT) AS CtTotalDesc,
                    CAST(ISNULL(c.CtNetoExento, 0) AS FLOAT) AS CtNetoExento,
                    CAST(ISNULL(c.CtNetoAfecto, 0) AS FLOAT) AS CtNetoAfecto,
                    CAST(ISNULL(c.CtMonto, 0) AS FLOAT) AS CtMonto,
                    ISNULL(d.items, 0) AS items
                 " . $this->baseFromClause() . "
                 LEFT JOIN " . $this->itemsSubquery() . " ON d.CotNum = c.CotNum
                 WHERE {$where}
                 GROUP BY c.CotNum, c.CtFem, c.CodAux, c.NomCon, c.VenCod, v.VenDes, c.CtEstado, c.CtSubTotal, c.CtTotalDesc, c.CtNetoExento, c.CtNetoAfecto, c.CtMonto, d.items
                 ORDER BY c.CtFem DESC, c.CotNum DESC";
        $rowsParams = $params;
        if ($limit > 0) {
            $rowSql .= " OFFSET ? ROWS FETCH NEXT ? ROWS ONLY";
            $rowsParams = array_merge($rowsParams, [$offset, $limit]);
        }
        $rows = array_map([$this, 'mapRow'], $this->softlandAll($rowSql, $rowsParams));

        return [
            'total' => (int)($summary['total'] ?? 0),
            'rows' => $rows,
            'totals' => [
                'subtotal' => (float)($summary['subtotal'] ?? 0),
                'descuento' => (float)($summary['descuento'] ?? 0),
                'neto_exento' => (float)($summary['neto_exento'] ?? 0),
                'neto_afecto' => (float)($summary['neto_afecto'] ?? 0),
                'monto' => (float)($summary['monto'] ?? 0),
            ],
        ];
    }

    private function resumen(array $payload, array $query): array
    {
        $monthQuery = $query;
        $monthQuery['scope'] = 'month';
        $month = $this->fetchPage($payload, $monthQuery, 'month', 20, 0);

        $allQuery = $query;
        $allQuery['scope'] = 'all';
        $all = $this->fetchPage($payload, $allQuery, 'all', 0, 0);

        return [
            'ok' => true,
            'mes' => [
                'totalCotizaciones' => $month['total'],
                'montoCotizado' => (int)round($month['totals']['monto'] ?? 0),
                'subtotal' => (int)round($month['totals']['subtotal'] ?? 0),
                'totalDescuento' => (int)round($month['totals']['descuento'] ?? 0),
                'preview' => $month['rows'],
            ],
            'total' => [
                'totalCotizaciones' => $all['total'],
                'montoCotizado' => (int)round($all['totals']['monto'] ?? 0),
                'subtotal' => (int)round($all['totals']['subtotal'] ?? 0),
                'totalDescuento' => (int)round($all['totals']['descuento'] ?? 0),
                'preview' => $all['rows'],
            ],
        ];
    }

    private function listado(array $payload, array $query): array
    {
        $scope = $this->currentScope($query);
        $page = max(1, (int)($query['page'] ?? $query['pagina'] ?? 1));
        $limit = (int)($query['limit'] ?? $query['por_pagina'] ?? 20);
        $limit = $limit <= 0 ? 20 : min($limit, 100);
        $offset = ($page - 1) * $limit;

        $data = $this->fetchPage($payload, $query, $scope, $limit, $offset);

        return [
            'ok' => true,
            'page' => $page,
            'limit' => $limit,
            'total' => $data['total'],
            'cotizaciones' => $data['rows'],
            'totales' => $data['totals'],
        ];
    }

    private function filtros(array $payload, array $query): array
    {
        $scope = $this->currentScope($query);
        $periodo = $this->monthYear($query);
        $params = [];
        $where = $this->buildFilters($payload, $query, $scope, $params);

        if ($where === '1=0') {
            return ['ok' => true, 'vendedores' => [], 'estados' => []];
        }

        $vendorRows = $this->softlandAll(
            "SELECT DISTINCT
                LTRIM(RTRIM(c.VenCod)) AS codigo,
                COALESCE(NULLIF(LTRIM(RTRIM(CONVERT(varchar(max), v.VenDes))), ''), LTRIM(RTRIM(c.VenCod))) AS nombre
             " . $this->baseFromClause() . "
             WHERE {$where}
             ORDER BY nombre ASC, codigo ASC",
            $params
        );

        $estadoRows = $this->softlandAll(
            "SELECT DISTINCT
                LTRIM(RTRIM(c.CtEstado)) AS estado
             " . $this->baseFromClause() . "
             WHERE {$where}
             ORDER BY estado ASC",
            $params
        );

        return [
            'ok' => true,
            'periodo' => $periodo,
            'vendedores' => array_values(array_filter(array_map(static function (array $row): array {
                $codigo = trim((string)($row['codigo'] ?? ''));
                if ($codigo === '') {
                    return [];
                }
                return [
                    'codigo' => $codigo,
                    'nombre' => trim((string)($row['nombre'] ?? '')) ?: $codigo,
                ];
            }, $vendorRows))),
            'estados' => array_values(array_filter(array_map(static fn(array $row): string => trim((string)($row['estado'] ?? '')), $estadoRows))),
        ];
    }

    private function detalle(int $cotNum, array $payload): array
    {
        if ($cotNum <= 0) {
            throw new RuntimeException('Cotización inválida.', 400);
        }

        $params = [$cotNum];
        $accessCodes = $this->userVendorCodes($payload);
        if (!$accessCodes) {
            throw new RuntimeException('Sin acceso a esta cotización.', 403);
        }

        $where = 'c.CotNum = ? AND ' . $this->vendorFilterSql($accessCodes, $params);

        $header = $this->softlandOne(
            "SELECT TOP 1
                c.CotNum,
                CONVERT(varchar(10), c.CtFem, 120) AS fecha_formato,
                LTRIM(RTRIM(c.CodAux)) AS CodAux,
                COALESCE(NULLIF(LTRIM(RTRIM(CONVERT(varchar(max), c.NomCon))), ''), LTRIM(RTRIM(c.CodAux))) AS NomCon,
                LTRIM(RTRIM(c.VenCod)) AS VenCod,
                COALESCE(NULLIF(LTRIM(RTRIM(CONVERT(varchar(max), v.VenDes))), ''), LTRIM(RTRIM(c.VenCod))) AS vendedor_nombre,
                LTRIM(RTRIM(COALESCE(c.CtEstado, ''))) AS CtEstado,
                CAST(ISNULL(c.CtSubTotal, 0) AS FLOAT) AS CtSubTotal,
                CAST(ISNULL(c.CtTotalDesc, 0) AS FLOAT) AS CtTotalDesc,
                CAST(ISNULL(c.CtNetoExento, 0) AS FLOAT) AS CtNetoExento,
                CAST(ISNULL(c.CtNetoAfecto, 0) AS FLOAT) AS CtNetoAfecto,
                CAST(ISNULL(c.CtMonto, 0) AS FLOAT) AS CtMonto
             " . $this->baseFromClause() . "
             WHERE {$where}",
            $params
        );

        if (!$header) {
            throw new RuntimeException('Cotización no encontrada.', 404);
        }

        $detalle = $this->softlandAll(
            "SELECT
                d.CotNum,
                d.CtLinea,
                RTRIM(d.CodProd) AS CodProd,
                COALESCE(NULLIF(LTRIM(RTRIM(CONVERT(varchar(max), d.DetProd))), ''), RTRIM(d.CodProd)) AS DetProd,
                RTRIM(d.CodUMed) AS CodUMed,
                CAST(ISNULL(d.CtCant, 0) AS FLOAT) AS CtCant,
                CAST(ISNULL(d.CtPrecio, 0) AS FLOAT) AS CtPrecio,
                CAST(ISNULL(d.CtSubTotal, 0) AS FLOAT) AS CtSubTotal,
                CAST(ISNULL(d.CtTotDesc, 0) AS FLOAT) AS CtTotDesc,
                CAST(ISNULL(d.CtTotLinea, 0) AS FLOAT) AS CtTotLinea,
                CAST(ISNULL(d.PorcIncidenciaKit, 0) AS FLOAT) AS PorcIncidenciaKit
             FROM [PRODIN].[softland].[nwdetcot] d
             WHERE d.CotNum = ?
             ORDER BY d.CtLinea ASC",
            [$cotNum]
        );

        return [
            'ok' => true,
            'cotizacion' => array_merge($this->mapRow($header), [
                'detalle' => array_map(static function (array $row): array {
                    return [
                        'CotNum' => (int)($row['CotNum'] ?? 0),
                        'CtLinea' => (int)($row['CtLinea'] ?? 0),
                        'CodProd' => trim((string)($row['CodProd'] ?? '')),
                        'DetProd' => trim((string)($row['DetProd'] ?? '')),
                        'CodUMed' => trim((string)($row['CodUMed'] ?? '')),
                        'CtCant' => (float)($row['CtCant'] ?? 0),
                        'CtPrecio' => (float)($row['CtPrecio'] ?? 0),
                        'CtSubTotal' => (float)($row['CtSubTotal'] ?? 0),
                        'CtTotDesc' => (float)($row['CtTotDesc'] ?? 0),
                        'CtTotLinea' => (float)($row['CtTotLinea'] ?? 0),
                        'PorcIncidenciaKit' => (float)($row['PorcIncidenciaKit'] ?? 0),
                    ];
                }, $detalle),
            ]),
        ];
    }
}
