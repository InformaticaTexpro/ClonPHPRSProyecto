<?php
declare(strict_types=1);

final class GerenciaService
{
    use SharedServiceHelpers;

    public function __construct(private Database $db, private ?SoftlandBridgeClient $bridgeClient = null)
    {
    }

    private function bridgeConfigured(): bool
    {
        return $this->bridgeClient instanceof SoftlandBridgeClient
            && $this->bridgeClient->isEnabled()
            && $this->bridgeClient->isConfigured();
    }

    public function route(array $payload, string $method, string $path, array $query, array $body): array
    {
        $this->assertGerenciaOrAdmin($payload);

        if ($this->bridgeConfigured()) {
            return match (true) {
                $method === 'GET' && $path === '/comercial/resumen' => $this->bridgeClient->get('/gerencia/resumen', [
                    'anio' => $this->validarAnio($query['anio'] ?? null),
                ]),
                $method === 'GET' && $path === '/comercial/mensual' => $this->bridgeClient->get('/gerencia/mensual', [
                    'anio' => $this->validarAnio($query['anio'] ?? null),
                    'mes' => $this->validarMes($query['mes'] ?? null),
                ]),
                $method === 'GET' && $path === '/comercial/estadisticas-ventas' => $this->bridgeClient->get('/gerencia/estadisticas-ventas', [
                    'anio' => $this->validarAnio($query['anio'] ?? null),
                    'mes' => $this->validarMes($query['mes'] ?? null),
                ]),
                default => throw new RuntimeException('Ruta de gerencia no encontrada', 404),
            };
        }

        return match (true) {
            $method === 'GET' && $path === '/comercial/resumen' => $this->resumenComercial($query),
            $method === 'GET' && $path === '/comercial/mensual' => $this->mensualComercial($query),
            $method === 'GET' && $path === '/comercial/estadisticas-ventas' => $this->estadisticasVentas($query),
            default => throw new RuntimeException('Ruta de gerencia no encontrada', 404),
        };
    }

    private function assertGerenciaOrAdmin(array $payload): void
    {
        if ((bool)($payload['is_admin'] ?? false)) {
            return;
        }

        $area = $this->normalizeArea($payload['area'] ?? '');
        if (!in_array($area, ['gerencia', 'admin', 'administracion'], true)) {
            throw new RuntimeException('Acceso restringido a Gerencia o administradores.', 403);
        }
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

    private function softlandRows(string $sql, array $params = []): array
    {
        $stmt = $this->db->softland()->prepare($sql);
        $stmt->execute(array_values($params));
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    private function softlandOne(string $sql, array $params = []): array
    {
        $rows = $this->softlandRows($sql, $params);
        return $rows[0] ?? [];
    }

    private function validarAnio(mixed $valor): int
    {
        if ($valor === null || $valor === '') {
            throw new RuntimeException('El ano es obligatorio.', 400);
        }

        $anio = (int)$valor;
        $maximo = (int)date('Y') + 1;
        if ($anio < 2000 || $anio > $maximo) {
            throw new RuntimeException("El ano debe estar entre 2000 y {$maximo}.", 400);
        }

        return $anio;
    }

    private function validarMes(mixed $valor): int
    {
        if ($valor === null || $valor === '') {
            throw new RuntimeException('El mes es obligatorio.', 400);
        }

        $mes = (int)$valor;
        if ($mes < 1 || $mes > 12) {
            throw new RuntimeException('El mes debe estar entre 1 y 12.', 400);
        }

        return $mes;
    }

    private function porcentajeDescuento(float $venta, float $real): ?float
    {
        if ($real <= 0) {
            return null;
        }
        return round((1 - ($venta / $real)) * 100, 2);
    }

    private function variacion(float $actual, float $anterior): ?float
    {
        if ($anterior <= 0) {
            return null;
        }
        return round((($actual - $anterior) / $anterior) * 100, 2);
    }

    private function participacion(float $venta, float $total): float
    {
        if ($total <= 0) {
            return 0.0;
        }
        return round(($venta / $total) * 100, 2);
    }

    private function categoryMap(): array
    {
        try {
            $rows = $this->db->fetchAll('SELECT Cta, Categoria FROM categoriasproducto');
        } catch (Throwable) {
            return [];
        }

        $map = [];
        foreach ($rows as $row) {
            $cta = trim((string)($row['Cta'] ?? ''));
            if ($cta === '') {
                continue;
            }
            $map[$cta] = trim((string)($row['Categoria'] ?? '')) ?: 'Otros';
        }

        return $map;
    }

    private function monthRange(int $anio, ?int $mes = null): array
    {
        if ($mes === null) {
            return [sprintf('%04d-01-01', $anio), sprintf('%04d-12-31', $anio)];
        }

        $start = sprintf('%04d-%02d-01', $anio, $mes);
        $end = (new DateTimeImmutable($start))->modify('first day of next month')->format('Y-m-d');
        return [$start, $end];
    }

    private function baseSalesRows(int $anio, ?int $mes = null): array
    {
        [$desde, $hasta] = $this->monthRange($anio, $mes);
        $sql = "
            SELECT
                RTRIM(enc.CodVendedor) AS codigoVendedor,
                RTRIM(COALESCE(vend.VenDes, enc.CodVendedor)) AS nombreVendedor,
                RTRIM(enc.CodAux) AS codigoCliente,
                RTRIM(COALESCE(cli.NomAux, enc.CodAux)) AS cliente,
                RTRIM(mov.CodProd) AS codigoProducto,
                RTRIM(COALESCE(prod.DesProd, mov.CodProd)) AS producto,
                RTRIM(COALESCE(prod.CtaVentas, '')) AS cuentaCategoria,
                CAST(ISNULL(mov.TotLinea, 0) AS FLOAT) AS venta,
                CAST(ISNULL(mov.CantFacturada, 0) * ISNULL(prod.PrecioVta, 0) AS FLOAT) AS ventaReal
            FROM [PRODIN].[softland].[iw_gsaen] enc
            INNER JOIN [PRODIN].[softland].[iw_gmovi] mov
                ON mov.NroInt = enc.NroInt AND mov.Tipo = enc.Tipo
            LEFT JOIN [PRODIN].[softland].[iw_tprod] prod
                ON LTRIM(RTRIM(prod.CodProd)) = LTRIM(RTRIM(mov.CodProd))
            LEFT JOIN [PRODIN].[softland].[cwtauxi] cli
                ON cli.CodAux = enc.CodAux
            LEFT JOIN [PRODIN].[softland].[cwtvend] vend
                ON vend.VenCod = enc.CodVendedor
            WHERE enc.Tipo IN ('F', 'N', 'D')
              AND enc.Estado <> 'A'
              AND enc.Fecha >= ?
              AND enc.Fecha < ?
            ORDER BY enc.Fecha DESC, enc.Folio DESC";

        return $this->softlandRows($sql, [$desde, $hasta]);
    }

    private function categoryDistribution(array $rows, array $categoryMap): array
    {
        $grouped = [];
        foreach ($rows as $row) {
            $cta = trim((string)($row['cuentaCategoria'] ?? ''));
            $categoria = $categoryMap[$cta] ?? ($cta !== '' ? $cta : 'Sin categoria');
            $grouped[$categoria] = ($grouped[$categoria] ?? 0) + (float)($row['venta'] ?? 0);
        }

        $items = [];
        foreach ($grouped as $categoria => $venta) {
            $items[] = [
                'categoria' => $categoria,
                'venta' => round($venta),
            ];
        }

        usort($items, static fn(array $a, array $b): int => ($b['venta'] <=> $a['venta']) ?: strcmp($a['categoria'], $b['categoria']));
        $total = array_sum(array_column($items, 'venta'));

        foreach ($items as &$item) {
            $item['participacion'] = $this->participacion((float)$item['venta'], (float)$total);
        }
        unset($item);

        return ['total' => (int)round($total), 'items' => $items];
    }

    private function obtenerMontosDescuento(int $anio, int $mesLimite, ?int $mesExacto = null): array
    {
        $sql = "
            SELECT
                ROUND(SUM(m.TotLinea), 0) AS montoVenta,
                ROUND(SUM(m.CantFacturada * ISNULL(t.PrecioVta, 0)), 0) AS montoReal
            FROM [PRODIN].[softland].[iw_gsaen] enc
            INNER JOIN [PRODIN].[softland].[iw_gmovi] m
                ON m.NroInt = enc.NroInt AND m.Tipo = enc.Tipo
            INNER JOIN [PRODIN].[softland].[iw_tprod] t
                ON t.CodProd = m.CodProd
            LEFT JOIN [PRODIN].[softland].[cwtcvcl] cvl
                ON cvl.CodAux = enc.CodAux
            WHERE enc.Tipo IN ('F', 'N', 'D')
              AND enc.Estado <> 'A'
              AND YEAR(enc.Fecha) = ?
        ";

        $params = [$anio];
        if ($mesExacto === null) {
            $sql .= ' AND MONTH(enc.Fecha) <= ?';
            $params[] = $mesLimite;
        } else {
            $sql .= ' AND MONTH(enc.Fecha) = ?';
            $params[] = $mesExacto;
        }

        $fila = $this->softlandOne($sql, $params);
        $montoVenta = (float)($fila['montoVenta'] ?? $fila['MontoVenta'] ?? 0);
        $montoReal = (float)($fila['montoReal'] ?? $fila['MontoReal'] ?? 0);

        return [
            'montoVenta' => (int)round($montoVenta),
            'montoReal' => (int)round($montoReal),
            'porcentajeDescuento' => $this->porcentajeDescuento($montoVenta, $montoReal),
        ];
    }

    private function loadVendorRelations(): array
    {
        $rows = $this->db->fetchAll(
            'SELECT
                u.id AS usuarioId,
                u.codigo AS codigoPrincipal,
                u.nombre AS vendedor,
                uv.cod_vendedor AS codigoAsociado,
                uv.tipo
             FROM usuario u
             INNER JOIN usuario_vendedor uv ON uv.usuario_id = u.id
             WHERE u.is_active = 1
             ORDER BY u.nombre ASC, uv.tipo ASC, uv.cod_vendedor ASC'
        );

        return array_map(static function (array $row): array {
            return [
                'usuarioId' => (int)($row['usuarioId'] ?? 0),
                'codigoPrincipal' => trim((string)($row['codigoPrincipal'] ?? '')),
                'vendedor' => trim((string)($row['vendedor'] ?? '')),
                'codigoAsociado' => trim((string)($row['codigoAsociado'] ?? '')),
                'tipo' => strtoupper(trim((string)($row['tipo'] ?? ''))),
            ];
        }, $rows);
    }

    private function loadMetaForUser(int $usuarioId, int $anio, int $mes): ?float
    {
        try {
            $row = $this->db->fetchOne(
                "SELECT meta
                 FROM vendedor_meta
                 WHERE usuario_id = ?
                   AND YEAR(fecha) = ?
                   AND COALESCE(activo, 1) = 1
                   AND (
                     (tipo_periodo = 'mensual' AND MONTH(fecha) = ?)
                     OR tipo_periodo = 'anual'
                   )
                 ORDER BY CASE WHEN tipo_periodo = 'mensual' THEN 0 ELSE 1 END, fecha ASC, id ASC
                 LIMIT 1",
                [$usuarioId, $anio, $mes]
            );
            return isset($row['meta']) ? (float)$row['meta'] : null;
        } catch (Throwable $e) {
            if (str_contains(strtolower($e->getMessage()), 'vendedor_meta')) {
                return null;
            }
            throw $e;
        }
    }

    private function monthlyVendorSummary(array $rows, int $anio, int $mes): array
    {
        $relations = $this->loadVendorRelations();
        $metaDisponible = true;
        $byCode = [];
        $groups = [];

        foreach ($relations as $relation) {
            $code = $relation['codigoAsociado'];
            if ($code === '') {
                continue;
            }
            $key = 'usuario:' . $relation['usuarioId'];
            $byCode[$code] = $relation + ['key' => $key];
            if (!isset($groups[$key])) {
                $groups[$key] = [
                    'usuarioId' => $relation['usuarioId'],
                    'codigoPrincipal' => $relation['codigoPrincipal'] ?: $code,
                    'vendedor' => $relation['vendedor'] ?: $code,
                    'venta' => 0.0,
                    'ventaReal' => 0.0,
                    'codigos' => [],
                ];
            }
            $groups[$key]['codigos'][$code] = [
                'codigo' => $code,
                'nombreAsociado' => $relation['vendedor'] ?: $code,
                'venta' => 0.0,
                'ventaReal' => 0.0,
                'meta' => 0.0,
                'esPrincipal' => $this->normalizeCode($code) === $this->normalizeCode($groups[$key]['codigoPrincipal']),
            ];
        }

        foreach ($rows as $row) {
            $code = trim((string)($row['codigoVendedor'] ?? ''));
            if ($code === '') {
                continue;
            }
            $venta = (float)($row['venta'] ?? 0);
            $real = (float)($row['ventaReal'] ?? 0);
            $relation = $byCode[$code] ?? null;
            $key = $relation['key'] ?? ('codigo:' . $code);
            if (!isset($groups[$key])) {
                $groups[$key] = [
                    'usuarioId' => null,
                    'codigoPrincipal' => $code,
                    'vendedor' => trim((string)($row['nombreVendedor'] ?? '')) ?: $code,
                    'venta' => 0.0,
                    'ventaReal' => 0.0,
                    'codigos' => [],
                ];
            }
            if (!isset($groups[$key]['codigos'][$code])) {
                $groups[$key]['codigos'][$code] = [
                    'codigo' => $code,
                    'nombreAsociado' => trim((string)($row['nombreVendedor'] ?? '')) ?: $code,
                    'venta' => 0.0,
                    'ventaReal' => 0.0,
                    'meta' => 0.0,
                    'esPrincipal' => $this->normalizeCode($code) === $this->normalizeCode($groups[$key]['codigoPrincipal']),
                ];
            }
            $groups[$key]['venta'] += $venta;
            $groups[$key]['ventaReal'] += $real;
            $groups[$key]['codigos'][$code]['venta'] += $venta;
            $groups[$key]['codigos'][$code]['ventaReal'] += $real;
        }

        $items = [];
        foreach ($groups as $group) {
            $meta = null;
            if (is_int($group['usuarioId']) && $group['usuarioId'] > 0) {
                $meta = $this->loadMetaForUser((int)$group['usuarioId'], $anio, $mes);
            } else {
                $metaDisponible = false;
            }

            $codigos = [];
            $metaAsignada = false;
            foreach ($group['codigos'] as $codeRow) {
                $codigoMeta = 0.0;
                if (!$metaAsignada && $meta !== null && $codeRow['esPrincipal']) {
                    $codigoMeta = $meta;
                    $metaAsignada = true;
                }
                $venta = (float)$codeRow['venta'];
                $real = (float)$codeRow['ventaReal'];
                $codigos[] = [
                    'codigo' => $codeRow['codigo'],
                    'nombreAsociado' => $codeRow['nombreAsociado'],
                    'venta' => round($venta),
                    'ventaReal' => round($real),
                    'meta' => round($codigoMeta),
                    'porcentajeDescuento' => $this->porcentajeDescuento($venta, $real),
                    'cumplimiento' => $codigoMeta > 0 ? round(($venta / $codigoMeta) * 100, 2) : null,
                ];
            }

            usort($codigos, static fn(array $a, array $b): int => ($b['venta'] <=> $a['venta']) ?: strcmp($a['codigo'], $b['codigo']));
            $ventaGrupo = (float)$group['venta'];
            $realGrupo = (float)$group['ventaReal'];
            $metaGrupo = $meta ?? 0.0;

            $items[] = [
                'codigoPrincipal' => $group['codigoPrincipal'],
                'vendedor' => $group['vendedor'],
                'venta' => round($ventaGrupo),
                'ventaReal' => round($realGrupo),
                'porcentajeDescuento' => $this->porcentajeDescuento($ventaGrupo, $realGrupo),
                'meta' => round($metaGrupo),
                'cumplimiento' => $metaGrupo > 0 ? round(($ventaGrupo / $metaGrupo) * 100, 2) : null,
                'cantidadCodigos' => count($codigos),
                'codigos' => $codigos,
            ];
        }

        usort($items, static function (array $a, array $b): int {
            $cmp = ($b['cumplimiento'] ?? -1) <=> ($a['cumplimiento'] ?? -1);
            if ($cmp !== 0) {
                return $cmp;
            }
            return ($b['venta'] <=> $a['venta']) ?: strcmp($a['vendedor'], $b['vendedor']);
        });

        return ['items' => $items, 'metaDisponible' => $metaDisponible];
    }

    private function normalizeCode(string $value): string
    {
        $code = trim($value);
        $code = preg_replace('/^0+(?=\d)/', '', $code) ?? $code;
        return $code === '' ? $value : $code;
    }

    private function consolidarEstadisticasVentas(array $ventasRows, array $gruposRows, array $relaciones): array
    {
        $relacionesPorCodigo = [];
        $relacionesPorUsuario = [];
        foreach ($relaciones as $relacion) {
            $codigo = trim((string)($relacion['codigoAsociado'] ?? ''));
            if ($codigo === '') {
                continue;
            }
            $usuarioId = (int)($relacion['usuarioId'] ?? 0);
            $relacionesPorCodigo[$codigo][] = $relacion;
            $relacionesPorUsuario[$usuarioId][] = $relacion;
        }

        $gruposPorCodigo = [];
        $descripcionPorCodigo = [];
        foreach ($gruposRows as $fila) {
            $codigo = trim((string)($fila['codigoVendedor'] ?? ''));
            $grupo = trim((string)($fila['grupo'] ?? ''));
            $descripcion = trim((string)($fila['descripcion'] ?? ''));
            if ($codigo === '') {
                continue;
            }
            $gruposPorCodigo[$codigo][] = $grupo;
            if ($descripcion !== '' && !isset($descripcionPorCodigo[$codigo])) {
                $descripcionPorCodigo[$codigo] = $descripcion;
            }
        }

        $grouped = [];
        foreach ($ventasRows as $fila) {
            $codigo = trim((string)($fila['codigoVendedor'] ?? ''));
            if ($codigo === '') {
                continue;
            }
            $venta = (float)($fila['neto'] ?? 0);
            $relacion = $relacionesPorCodigo[$codigo][0] ?? null;
            $usuarioId = (int)($relacion['usuarioId'] ?? 0);
            $codigoPrincipal = trim((string)($relacion['codigoPrincipal'] ?? $codigo));
            $vendedor = trim((string)($relacion['vendedor'] ?? '')) ?: trim((string)($fila['descripcion'] ?? '')) ?: $codigo;
            $grupo = trim((string)($gruposPorCodigo[$codigo][0] ?? ''));
            if ($grupo === '') {
                $grupo = 'Sin grupo de negocio';
            }
            $groupKey = $usuarioId > 0 ? 'usuario:' . $usuarioId : 'codigo:' . $codigo;

            if (!isset($grouped[$groupKey])) {
                $grouped[$groupKey] = [
                    'grupo' => $grupo,
                    'total' => 0.0,
                    'vendedores' => [],
                ];
            }
            if (!isset($grouped[$groupKey]['vendedores'][$codigo])) {
                $grouped[$groupKey]['vendedores'][$codigo] = [
                    'codigoPrincipal' => $codigoPrincipal,
                    'vendedor' => $vendedor,
                    'neto' => 0.0,
                    'codigos' => [],
                ];
            }
            if (!isset($grouped[$groupKey]['vendedores'][$codigo]['codigos'][$codigo])) {
                $grouped[$groupKey]['vendedores'][$codigo]['codigos'][$codigo] = [
                    'codigo' => $codigo,
                    'descripcion' => $descripcionPorCodigo[$codigo] ?? $vendedor,
                    'grupo' => $grupo,
                    'neto' => 0.0,
                ];
            }
            $grouped[$groupKey]['vendedores'][$codigo]['neto'] += $venta;
            $grouped[$groupKey]['vendedores'][$codigo]['codigos'][$codigo]['neto'] += $venta;
            $grouped[$groupKey]['total'] += $venta;
        }

        $items = [];
        $codigosUnicos = [];
        $cantidadVendedores = 0;
        foreach ($grouped as $group) {
            $vendedores = [];
            foreach ($group['vendedores'] as $vendedor) {
                $codigos = [];
                foreach ($vendedor['codigos'] as $codigoRow) {
                    $codigos[] = [
                        'codigo' => $codigoRow['codigo'],
                        'descripcion' => $codigoRow['descripcion'],
                        'grupo' => $codigoRow['grupo'],
                        'neto' => round($codigoRow['neto']),
                        'participacion' => $this->participacion((float)$codigoRow['neto'], (float)$vendedor['neto']),
                    ];
                    $codigosUnicos[$codigoRow['codigo']] = true;
                }
                usort($codigos, static fn(array $a, array $b): int => ($b['neto'] <=> $a['neto']) ?: strcmp($a['codigo'], $b['codigo']));
                $vendedores[] = [
                    'codigoPrincipal' => $vendedor['codigoPrincipal'],
                    'vendedor' => $vendedor['vendedor'],
                    'neto' => round($vendedor['neto']),
                    'participacion' => $this->participacion((float)$vendedor['neto'], (float)$group['total']),
                    'cantidadCodigos' => count($codigos),
                    'codigos' => $codigos,
                ];
            }
            usort($vendedores, static fn(array $a, array $b): int => ($b['neto'] <=> $a['neto']) ?: strcmp($a['vendedor'], $b['vendedor']));
            $items[] = [
                'grupo' => $group['grupo'],
                'total' => round($group['total']),
                'vendedores' => $vendedores,
            ];
            $cantidadVendedores += count($vendedores);
        }

        usort($items, static fn(array $a, array $b): int => strcmp($a['grupo'], $b['grupo']));

        return [
            'total' => array_sum(array_column($items, 'total')),
            'cantidadUnidades' => count($items),
            'cantidadVendedores' => $cantidadVendedores,
            'cantidadCodigos' => count($codigosUnicos),
            'grupos' => $items,
        ];
    }

    private function loadMetaMapForUsers(int $anio, array $usuarioIds, int $mes): array
    {
        $usuarioIds = array_values(array_unique(array_filter(array_map('intval', $usuarioIds), static fn(int $id): bool => $id > 0)));
        if (!$usuarioIds) {
            return ['disponible' => true, 'map' => []];
        }

        try {
            $placeholders = implode(',', array_fill(0, count($usuarioIds), '?'));
            $rows = $this->db->fetchAll(
                "SELECT usuario_id, meta, fecha, tipo_periodo
                 FROM vendedor_meta
                 WHERE activo = 1
                   AND YEAR(fecha) = ?
                   AND usuario_id IN ($placeholders)",
                array_merge([$anio], $usuarioIds)
            );
        } catch (Throwable $e) {
            if (str_contains(strtolower($e->getMessage()), 'vendedor_meta') || str_contains(strtolower($e->getMessage()), 'doesn\'t exist')) {
                return ['disponible' => false, 'map' => []];
            }
            throw $e;
        }

        $map = [];
        foreach ($rows as $row) {
            $usuarioId = (int)($row['usuario_id'] ?? 0);
            $tipoPeriodo = trim((string)($row['tipo_periodo'] ?? 'mensual'));
            $fecha = (string)($row['fecha'] ?? '');
            $fechaMes = (int)substr($fecha, 5, 2);
            if (!isset($map[$usuarioId])) {
                $map[$usuarioId] = ['mensual' => null, 'anual' => null];
            }
            if ($tipoPeriodo === 'mensual' && $fechaMes === $mes) {
                $map[$usuarioId]['mensual'] = (float)($row['meta'] ?? 0);
            }
            if ($tipoPeriodo === 'anual') {
                $map[$usuarioId]['anual'] = (float)($row['meta'] ?? 0);
            }
        }

        return ['disponible' => true, 'map' => $map];
    }

    private function compararVentasAnuales(int $anio, int $mesLimite): array
    {
        [$desde, $hasta] = $this->monthRange($anio - 2, null);
        $hasta = sprintf('%04d-12-31', $anio);
        $rows = $this->softlandRows(
            "
            SELECT YEAR(enc.Fecha) AS anio, MONTH(enc.Fecha) AS mes, ROUND(SUM(enc.SubTotal), 0) AS ventas
            FROM [PRODIN].[softland].[iw_gsaen] enc
            WHERE enc.Tipo IN ('F', 'N', 'D')
              AND enc.Estado <> 'A'
              AND enc.Fecha >= ?
              AND enc.Fecha < DATEADD(DAY, 1, ?)
            GROUP BY YEAR(enc.Fecha), MONTH(enc.Fecha)
            ORDER BY anio ASC, mes ASC
            ",
            [$desde, $hasta]
        );

        $years = [$anio - 2, $anio - 1, $anio];
        $byYear = [];
        foreach ($years as $year) {
            $byYear[$year] = array_fill(1, 12, 0.0);
        }
        foreach ($rows as $row) {
            $year = (int)($row['anio'] ?? 0);
            $month = (int)($row['mes'] ?? 0);
            if (!isset($byYear[$year]) || $month < 1 || $month > 12) {
                continue;
            }
            if ($year === $anio && $month > $mesLimite) {
                continue;
            }
            $byYear[$year][$month] = (float)($row['ventas'] ?? 0);
        }

        $comparativo = [];
        foreach (range(1, 12) as $mes) {
            $valores = [];
            foreach ($years as $year) {
                $valores[] = (int)round($byYear[$year][$mes] ?? 0);
            }
            $comparativo[] = [
                'mes' => $mes,
                'valores' => $valores,
                'variaciones' => [
                    null,
                    $this->variacion((float)$valores[1], (float)$valores[0]),
                    $this->variacion((float)$valores[2], (float)$valores[1]),
                ],
            ];
        }

        $totales = [];
        foreach ($years as $year) {
            $totales[] = (int)round(array_sum($byYear[$year]));
        }

        return [
            'periodos' => $years,
            'comparativoMensual' => $comparativo,
            'totales' => [
                'valores' => $totales,
                'variaciones' => [
                    null,
                    $this->variacion((float)$totales[1], (float)$totales[0]),
                    $this->variacion((float)$totales[2], (float)$totales[1]),
                ],
            ],
            'ventasAcumuladas' => $totales[2] ?? 0,
        ];
    }

    private function resumenComercial(array $query): array
    {
        $anio = $this->validarAnio($query['anio'] ?? null);
        if ($this->bridgeConfigured()) {
            $response = $this->bridgeClient->get('/gerencia/resumen', ['anio' => $anio]);
            if (!is_array($response) || !isset($response['ok'])) {
                throw new RuntimeException('Respuesta invalida del bridge para resumen comercial.', 502);
            }
            return $response;
        }

        if ($unavailable = $this->softlandUnavailable('el resumen comercial')) {
            return $unavailable;
        }

        $hoy = new DateTimeImmutable('now');
        $mesLimite = $anio === (int)$hoy->format('Y') ? (int)$hoy->format('n') : 12;

        $comparativa = $this->compararVentasAnuales($anio, $mesLimite);
        $descuento = $this->obtenerMontosDescuento($anio, $mesLimite);
        $categoriasRows = $this->softlandRows(
            "
            SELECT RTRIM(prod.CtaVentas) AS cuentaCategoria, ROUND(SUM(m.TotLinea), 0) AS venta
            FROM [PRODIN].[softland].[iw_gsaen] enc
            INNER JOIN [PRODIN].[softland].[iw_gmovi] m
                ON m.NroInt = enc.NroInt AND m.Tipo = enc.Tipo
            LEFT JOIN [PRODIN].[softland].[iw_tprod] prod
                ON LTRIM(RTRIM(prod.CodProd)) = LTRIM(RTRIM(m.CodProd))
            WHERE enc.Tipo IN ('F', 'N', 'D')
              AND enc.Estado <> 'A'
              AND YEAR(enc.Fecha) = ?
            GROUP BY prod.CtaVentas
            ORDER BY venta DESC
            ",
            [$anio]
        );

        $totalCategorias = array_sum(array_map(static fn(array $row): float => (float)($row['venta'] ?? 0), $categoriasRows));
        $categoryMap = $this->categoryMap();
        $categorias = [];
        foreach ($categoriasRows as $row) {
            $cta = trim((string)($row['cuentaCategoria'] ?? ''));
            $categoria = $categoryMap[$cta] ?? ($cta !== '' ? $cta : 'Sin categoria');
            $venta = (float)($row['venta'] ?? 0);
            $categorias[] = [
                'categoria' => $categoria,
                'venta' => round($venta),
                'participacion' => $this->participacion($venta, $totalCategorias),
            ];
        }

        usort($categorias, static fn(array $a, array $b): int => ($b['venta'] <=> $a['venta']) ?: strcmp($a['categoria'], $b['categoria']));

        return [
            'ok' => true,
            'data' => [
                'anioSeleccionado' => $anio,
                'mesLimite' => $mesLimite,
                'resumen' => [
                    'ventasAcumuladas' => (int)round((float)($descuento['montoVenta'] ?? 0)),
                    'montoReal' => (int)round((float)($descuento['montoReal'] ?? 0)),
                    'porcentajeDescuento' => $this->porcentajeDescuento(
                        (float)($descuento['montoVenta'] ?? 0),
                        (float)($descuento['montoReal'] ?? 0)
                    ),
                    'promedioMensual' => $mesLimite > 0 ? (int)round(((float)($descuento['montoVenta'] ?? 0)) / $mesLimite) : 0,
                ],
                'descuento' => [
                    'montoVenta' => (int)round((float)($descuento['montoVenta'] ?? 0)),
                    'montoReal' => (int)round((float)($descuento['montoReal'] ?? 0)),
                    'porcentajeDescuento' => $this->porcentajeDescuento(
                        (float)($descuento['montoVenta'] ?? 0),
                        (float)($descuento['montoReal'] ?? 0)
                    ),
                ],
                'periodos' => $comparativa['periodos'],
                'comparativoMensual' => $comparativa['comparativoMensual'],
                'totales' => $comparativa['totales'],
                'categorias' => $categorias,
                'totalCategorias' => (int)round($totalCategorias),
            ],
        ];
    }

    private function mensualComercial(array $query): array
    {
        $anio = $this->validarAnio($query['anio'] ?? null);
        $mes = $this->validarMes($query['mes'] ?? null);
        if ($unavailable = $this->softlandUnavailable('las ventas del mes')) {
            return $unavailable;
        }

        $rows = $this->baseSalesRows($anio, $mes);
        $descuento = $this->obtenerMontosDescuento($anio, $mes, $mes);

        $categoryMap = $this->categoryMap();
        $categorias = [];
        $clientes = [];
        $productos = [];
        $ventasPorVendedor = [];
        foreach ($rows as $row) {
            $venta = (float)($row['venta'] ?? 0);
            $ventaReal = (float)($row['ventaReal'] ?? 0);
            $codigoVendedor = trim((string)($row['codigoVendedor'] ?? ''));
            $nombreVendedor = trim((string)($row['nombreVendedor'] ?? ''));
            $codigoCliente = trim((string)($row['codigoCliente'] ?? ''));
            $cliente = trim((string)($row['cliente'] ?? ''));
            $codigoProducto = trim((string)($row['codigoProducto'] ?? ''));
            $producto = trim((string)($row['producto'] ?? ''));
            $cta = trim((string)($row['cuentaCategoria'] ?? ''));
            $categoria = $categoryMap[$cta] ?? ($cta !== '' ? $cta : 'Sin categoria');

            $categorias[$categoria] = ($categorias[$categoria] ?? 0) + $venta;
            $clientes[$codigoCliente !== '' ? $codigoCliente : $cliente] = [
                'codigoCliente' => $codigoCliente !== '' ? $codigoCliente : '',
                'cliente' => $cliente !== '' ? $cliente : ($codigoCliente !== '' ? $codigoCliente : 'Sin cliente'),
                'venta' => ($clientes[$codigoCliente !== '' ? $codigoCliente : $cliente]['venta'] ?? 0) + $venta,
            ];
            $productos[$codigoProducto !== '' ? $codigoProducto : $producto] = [
                'codigoProducto' => $codigoProducto !== '' ? $codigoProducto : '',
                'producto' => $producto !== '' ? $producto : ($codigoProducto !== '' ? $codigoProducto : 'Sin producto'),
                'categoria' => $categoria,
                'venta' => ($productos[$codigoProducto !== '' ? $codigoProducto : $producto]['venta'] ?? 0) + $venta,
            ];
            if ($codigoVendedor !== '') {
                if (!isset($ventasPorVendedor[$codigoVendedor])) {
                    $ventasPorVendedor[$codigoVendedor] = [
                        'codigoVendedor' => $codigoVendedor,
                        'nombreVendedor' => $nombreVendedor !== '' ? $nombreVendedor : $codigoVendedor,
                        'venta' => 0.0,
                        'ventaReal' => 0.0,
                    ];
                }
                $ventasPorVendedor[$codigoVendedor]['venta'] += $venta;
                $ventasPorVendedor[$codigoVendedor]['ventaReal'] += $ventaReal;
            }
        }

        $categoriasItems = [];
        $totalVentaMes = 0.0;
        foreach ($categorias as $categoria => $venta) {
            $categoriasItems[] = [
                'categoria' => $categoria,
                'venta' => round($venta),
            ];
            $totalVentaMes += $venta;
        }
        usort($categoriasItems, static fn(array $a, array $b): int => ($b['venta'] <=> $a['venta']) ?: strcmp($a['categoria'], $b['categoria']));
        foreach ($categoriasItems as &$item) {
            $item['participacion'] = $this->participacion((float)$item['venta'], $totalVentaMes);
        }
        unset($item);

        $clientesItems = [];
        foreach ($clientes as $item) {
            $clientesItems[] = [
                'codigoCliente' => $item['codigoCliente'] ?? '',
                'cliente' => $item['cliente'],
                'venta' => round((float)$item['venta']),
            ];
        }
        usort($clientesItems, static fn(array $a, array $b): int => ($b['venta'] <=> $a['venta']) ?: strcmp($a['cliente'], $b['cliente']));
        foreach ($clientesItems as &$item) {
            $item['participacion'] = $this->participacion((float)$item['venta'], $totalVentaMes);
        }
        unset($item);

        $productosItems = [];
        foreach ($productos as $item) {
            $productosItems[] = [
                'codigoProducto' => $item['codigoProducto'] ?? '',
                'producto' => $item['producto'],
                'categoria' => $item['categoria'],
                'venta' => round((float)$item['venta']),
            ];
        }
        usort($productosItems, static fn(array $a, array $b): int => ($b['venta'] <=> $a['venta']) ?: strcmp($a['producto'], $b['producto']));
        foreach ($productosItems as &$item) {
            $item['participacion'] = $this->participacion((float)$item['venta'], $totalVentaMes);
        }
        unset($item);

        $vendedores = $this->monthlyVendorSummary(array_values($ventasPorVendedor), $anio, $mes);

        return [
            'ok' => true,
            'data' => [
                'anio' => $anio,
                'mes' => $mes,
                'ventaMes' => (int)round((float)($descuento['montoVenta'] ?? 0)),
                'montoVenta' => (int)round((float)($descuento['montoVenta'] ?? 0)),
                'meta' => null,
                'metaMes' => null,
                'cumplimiento' => null,
                'montoReal' => (int)round((float)($descuento['montoReal'] ?? 0)),
                'porcentajeDescuento' => $this->porcentajeDescuento((float)($descuento['montoVenta'] ?? 0), (float)($descuento['montoReal'] ?? 0)),
                'descuento' => [
                    'montoVenta' => (int)round((float)($descuento['montoVenta'] ?? 0)),
                    'montoReal' => (int)round((float)($descuento['montoReal'] ?? 0)),
                    'porcentajeDescuento' => $this->porcentajeDescuento((float)($descuento['montoVenta'] ?? 0), (float)($descuento['montoReal'] ?? 0)),
                ],
                'metaDisponible' => $vendedores['metaDisponible'],
                'totalCategorias' => (int)round($totalVentaMes),
                'categorias' => $categoriasItems,
                'clientes' => $clientesItems,
                'productos' => $productosItems,
                'vendedores' => $vendedores['items'],
            ],
        ];
    }

    private function estadisticasVentas(array $query): array
    {
        $anio = $this->validarAnio($query['anio'] ?? null);
        $mes = $this->validarMes($query['mes'] ?? null);
        if ($unavailable = $this->softlandUnavailable('las estadisticas de ventas')) {
            return $unavailable;
        }

        [$desde, $hasta] = $this->monthRange($anio, $mes);
        $ventasRows = $this->softlandRows(
            "
            SELECT
                RTRIM(enc.CodVendedor) AS codigoVendedor,
                COALESCE(RTRIM(vend.VenDes), RTRIM(enc.CodVendedor)) AS descripcion,
                ROUND(SUM(mov.TotLinea), 0) AS neto
            FROM [PRODIN].[softland].[iw_gsaen] enc
            INNER JOIN [PRODIN].[softland].[iw_gmovi] mov
                ON mov.NroInt = enc.NroInt AND mov.Tipo = enc.Tipo
            LEFT JOIN [PRODIN].[softland].[cwtvend] vend
                ON LTRIM(RTRIM(vend.VenCod)) = LTRIM(RTRIM(enc.CodVendedor))
            WHERE enc.Fecha >= ?
              AND enc.Fecha < ?
              AND enc.Tipo IN ('F', 'N', 'D')
              AND enc.Estado <> 'A'
            GROUP BY enc.CodVendedor, vend.VenDes
            ORDER BY neto DESC
            ",
            [$desde, $hasta]
        );

        $gruposRows = $this->softlandRows(
            "
            SELECT
                RTRIM(vend.VenCod) AS codigoVendedor,
                RTRIM(vend.VenDes) AS descripcion,
                RTRIM(grupo.DesGrupo) AS grupo
            FROM [PRODIN].[softland].[ECGrupoT] grupo
            INNER JOIN [PRODIN].[softland].[WISusuarios] usr
                ON LTRIM(RTRIM(usr.CodGrTrab)) = LTRIM(RTRIM(grupo.CodGrupo))
            INNER JOIN [PRODIN].[softland].[cwtvend] vend
                ON LTRIM(RTRIM(vend.Usuario)) = LTRIM(RTRIM(usr.Usuario))
            ORDER BY grupo.DesGrupo, vend.VenCod
            "
        );

        $relaciones = $this->loadVendorRelations();
        $estadisticas = $this->consolidarEstadisticasVentas($ventasRows, $gruposRows, $relaciones);

        return [
            'ok' => true,
            'data' => [
                'mes' => $mes,
                'anio' => $anio,
                'total' => $estadisticas['total'],
                'resumen' => [
                    'ventaTotal' => $estadisticas['total'],
                    'cantidadUnidades' => $estadisticas['cantidadUnidades'],
                    'cantidadVendedores' => $estadisticas['cantidadVendedores'],
                    'cantidadCodigos' => $estadisticas['cantidadCodigos'],
                ],
                'grupos' => $estadisticas['grupos'],
            ],
        ];
    }
}
