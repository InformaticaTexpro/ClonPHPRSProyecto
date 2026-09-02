<?php
declare(strict_types=1);

final class GerenciaService
{
    use SharedServiceHelpers;

    public function __construct(private Database $db, private AnalyticsService $analytics)
    {
    }

    public function route(array $payload, string $method, string $path, array $query, array $body): array
    {
        $this->assertGerenciaOrAdmin($payload);

        return match (true) {
            $method === 'GET' && $path === '/comercial/resumen' => $this->resumenComercial($query),
            $method === 'GET' && $path === '/comercial/mensual' => $this->mensualComercial($query),
            $method === 'GET' && $path === '/comercial/estadisticas-ventas' => $this->estadisticasVentas($query),
            $method === 'GET' && $path === '/comercial/vendedores-principales' => $this->vendedoresPrincipales(),
            $method === 'GET' && $path === '/comercial/ventas-vendedor/cotizaciones' => $this->cotizacionesVendedor($query),
            $method === 'GET' && $path === '/comercial/ventas-vendedor/guias-pendientes' => $this->guiasPendientesVendedor($query),
            $method === 'GET' && $path === '/comercial/ventas-vendedor/clientes-nuevos' => $this->clientesNuevosVendedor($query),
            $method === 'GET' && $path === '/comercial/ventas-vendedor' => $this->ventasVendedor($query),
            default => throw new RuntimeException('Ruta de gerencia no encontrada', 404),
        };
    }

    private function vendedoresPrincipales(): array
    {
        $vendedores = [];
        foreach ($this->loadVendorRelations() as $relacion) {
            $usuarioId = (int)($relacion['usuarioId'] ?? 0);
            $codigo = trim((string)($relacion['codigoPrincipal'] ?? ''));
            if ($usuarioId <= 0 || $codigo === '' || ($relacion['tipo'] ?? '') === 'C' || isset($vendedores[$usuarioId])) {
                continue;
            }
            $vendedores[$usuarioId] = [
                'usuarioId' => $usuarioId,
                'codigoPrincipal' => $codigo,
                'nombre' => trim((string)($relacion['vendedor'] ?? '')) ?: $codigo,
            ];
        }

        $items = array_values($vendedores);
        usort($items, static fn(array $a, array $b): int => strcasecmp((string)$a['nombre'], (string)$b['nombre']));
        return ['ok' => true, 'vendedores' => $items];
    }

    private function ventasVendedor(array $query): array
    {
        $usuarioId = $this->validarVendedorPrincipal($query['vendedorId'] ?? null);
        $anio = $this->validarAnio($query['anio'] ?? null);
        $mes = $this->validarMes($query['mes'] ?? null);
        return $this->analytics->dashboardForUser($usuarioId, ['anio' => $anio, 'mes' => $mes]);
    }

    private function cotizacionesVendedor(array $query): array
    {
        $usuarioId = $this->validarVendedorPrincipal($query['vendedorId'] ?? null);
        $modo = trim((string)($query['modo'] ?? ''));
        if (!in_array($modo, ['historico', 'mensual'], true)) {
            throw new RuntimeException('Modo de cotizaciones no valido.', 400);
        }

        $params = ['modo' => $modo];
        if ($modo === 'mensual') {
            $params['anio'] = $this->validarAnio($query['anio'] ?? null);
            $params['mes'] = $this->validarMes($query['mes'] ?? null);
        }

        return $this->analytics->cotizacionesForUser($usuarioId, $params);
    }

    private function guiasPendientesVendedor(array $query): array
    {
        $usuarioId = $this->validarVendedorPrincipal($query['vendedorId'] ?? null);
        $anio = $this->validarAnio($query['anio'] ?? null);
        $mes = $this->validarMes($query['mes'] ?? null);
        return $this->analytics->pendingGuidesDetailForUser($usuarioId, $mes, $anio);
    }

    private function clientesNuevosVendedor(array $query): array
    {
        $usuarioId = $this->validarVendedorPrincipal($query['vendedorId'] ?? null);
        $params = ['anio' => $this->validarAnio($query['anio'] ?? null)];
        $codigo = trim((string)($query['codVendedor'] ?? ''));
        if ($codigo !== '') {
            $params['cod_vendedor'] = $codigo;
        }

        return [
            'ok' => true,
            'data' => $this->analytics->clientesNuevosCalendarioForUser($usuarioId, $params),
        ];
    }

    private function validarVendedorPrincipal(mixed $valor): int
    {
        $usuarioId = filter_var($valor, FILTER_VALIDATE_INT);
        if (!$usuarioId || $usuarioId <= 0) {
            throw new RuntimeException('Debe seleccionar un vendedor valido.', 400);
        }

        $permitidos = array_column($this->vendedoresPrincipales()['vendedores'], 'usuarioId');
        if (!in_array($usuarioId, $permitidos, true)) {
            throw new RuntimeException('Vendedor no encontrado.', 404);
        }

        return $usuarioId;
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
        $saleExpression = $this->commercialAmountSql('enc.Tipo', 'mov.TotLinea');
        $realExpression = $this->commercialAmountSql('enc.Tipo', 'mov.CantFacturada * ISNULL(prod.PrecioVta, 0)');
        $sql = "
            SELECT
                RTRIM(enc.CodVendedor) AS codigoVendedor,
                RTRIM(COALESCE(vend.VenDes, enc.CodVendedor)) AS nombreVendedor,
                RTRIM(enc.CodAux) AS codigoCliente,
                RTRIM(COALESCE(cli.NomAux, enc.CodAux)) AS cliente,
                RTRIM(mov.CodProd) AS codigoProducto,
                RTRIM(COALESCE(prod.DesProd, mov.CodProd)) AS producto,
                RTRIM(COALESCE(prod.CtaVentas, '')) AS cuentaCategoria,
                CAST($saleExpression AS FLOAT) AS venta,
                CAST($realExpression AS FLOAT) AS ventaReal
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
        $saleExpression = $this->commercialAmountSql('enc.Tipo', 'm.TotLinea');
        $realExpression = $this->commercialAmountSql('enc.Tipo', 'm.CantFacturada * ISNULL(t.PrecioVta, 0)');
        $sql = "
            SELECT
                ROUND(SUM($saleExpression), 0) AS montoVenta,
                ROUND(SUM($realExpression), 0) AS montoReal
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
            if (($relation['tipo'] ?? '') === 'C') {
                continue;
            }
            $code = $relation['codigoAsociado'];
            if ($code === '') {
                continue;
            }
            $key = 'usuario:' . $relation['usuarioId'];
            $byCode[$this->normalizeCode($code)] = $relation + ['key' => $key];
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
            $relation = $byCode[$this->normalizeCode($code)] ?? null;
            if ($relation === null) {
                continue;
            }
            $key = $relation['key'];
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

    private function monthlyVendorSalesRows(int $anio, int $mes): array
    {
        $saleExpression = $this->commercialAmountSql('enc.Tipo', 'mov.TotLinea');
        $realExpression = $this->commercialAmountSql('enc.Tipo', 'mov.CantFacturada * ISNULL(prod.PrecioVta, 0)');
        $rows = $this->softlandRows(
            "SELECT
                LTRIM(RTRIM(enc.CodVendedor)) AS codigoVendedor,
                MIN(LTRIM(RTRIM(COALESCE(vend.VenDes, enc.CodVendedor)))) AS nombreVendedor,
                SUM(CONVERT(decimal(38, 6), $saleExpression)) AS venta,
                SUM(CONVERT(decimal(38, 6), $realExpression)) AS ventaReal
             FROM [PRODIN].[softland].[iw_gsaen] enc
             INNER JOIN [PRODIN].[softland].[iw_gmovi] mov
                ON mov.NroInt = enc.NroInt AND mov.Tipo = enc.Tipo
             INNER JOIN [PRODIN].[softland].[iw_tprod] prod
                ON prod.CodProd = mov.CodProd
             LEFT JOIN [PRODIN].[softland].[cwtvend] vend
                ON LTRIM(RTRIM(vend.VenCod)) = LTRIM(RTRIM(enc.CodVendedor))
             WHERE enc.Tipo IN ('F', 'N', 'D')
               AND enc.Estado <> ?
               AND YEAR(enc.Fecha) = ?
               AND MONTH(enc.Fecha) = ?
             GROUP BY LTRIM(RTRIM(enc.CodVendedor))",
            ['A', $anio, $mes]
        );
        $relationCodes = array_column($this->loadVendorRelations(), 'codigoAsociado');
        return $this->analytics->applySharedSalesToVendorRows($rows, $mes, $anio, $relationCodes);
    }

    private function cumplimientoVendedoresResumen(array $vendors): array
    {
        $withTarget = 0;
        $metTarget = 0;
        foreach ($vendors as $vendor) {
            $target = (float)($vendor['meta'] ?? 0);
            if ($target <= 0) {
                continue;
            }
            $withTarget++;
            if ((float)($vendor['cumplimiento'] ?? 0) >= 100) {
                $metTarget++;
            }
        }

        return [
            'cantidadCumplen' => $metTarget,
            'cantidadConMeta' => $withTarget,
            'cantidadNoCumplen' => $withTarget - $metTarget,
            'cantidadSinMeta' => count($vendors) - $withTarget,
            'porcentajeCumplimiento' => $withTarget > 0 ? round(($metTarget / $withTarget) * 100, 2) : null,
            'vendedores' => $vendors,
        ];
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
            $codigoKey = $this->normalizeCode($codigo);
            $usuarioId = (int)($relacion['usuarioId'] ?? 0);
            if (!isset($relacionesPorCodigo[$codigoKey])) {
                $relacionesPorCodigo[$codigoKey] = $relacion;
            }
            if ($usuarioId > 0) {
                $relacionesPorUsuario[$usuarioId][] = $relacion;
            }
        }

        $grupoPorCodigo = [];
        $descripcionPorCodigo = [];
        foreach ($gruposRows as $fila) {
            $codigo = trim((string)($fila['codigoVendedor'] ?? ''));
            $grupo = trim((string)($fila['grupo'] ?? ''));
            $descripcion = trim((string)($fila['descripcion'] ?? ''));
            if ($codigo === '') {
                continue;
            }
            $codigoKey = $this->normalizeCode($codigo);
            if ($grupo !== '' && !isset($grupoPorCodigo[$codigoKey])) {
                $grupoPorCodigo[$codigoKey] = $grupo;
            }
            if ($descripcion !== '' && !isset($descripcionPorCodigo[$codigoKey])) {
                $descripcionPorCodigo[$codigoKey] = $descripcion;
            }
        }

        $grupoPorUsuario = [];
        foreach ($relacionesPorUsuario as $usuarioId => $relacionesUsuario) {
            $codigoPrincipal = trim((string)($relacionesUsuario[0]['codigoPrincipal'] ?? ''));
            $principalKey = $codigoPrincipal !== '' ? $this->normalizeCode($codigoPrincipal) : '';
            if ($principalKey !== '' && isset($grupoPorCodigo[$principalKey])) {
                $grupoPorUsuario[$usuarioId] = $grupoPorCodigo[$principalKey];
                continue;
            }
            foreach ($relacionesUsuario as $relacion) {
                $asociadoKey = $this->normalizeCode((string)($relacion['codigoAsociado'] ?? ''));
                if (isset($grupoPorCodigo[$asociadoKey])) {
                    $grupoPorUsuario[$usuarioId] = $grupoPorCodigo[$asociadoKey];
                    break;
                }
            }
        }

        $ventasPorCodigo = [];
        foreach ($ventasRows as $fila) {
            $codigo = trim((string)($fila['codigoVendedor'] ?? ''));
            if ($codigo === '') {
                continue;
            }
            $codigoKey = $this->normalizeCode($codigo);
            if (!isset($ventasPorCodigo[$codigoKey])) {
                $ventasPorCodigo[$codigoKey] = [
                    'codigo' => $codigo,
                    'descripcion' => trim((string)($fila['descripcion'] ?? '')),
                    'neto' => 0.0,
                ];
            }
            $ventasPorCodigo[$codigoKey]['neto'] += (float)($fila['neto'] ?? 0);
        }

        $unidades = [];
        foreach ($ventasPorCodigo as $codigoKey => $ventaCodigo) {
            $codigo = $ventaCodigo['codigo'];
            $relacion = $relacionesPorCodigo[$codigoKey] ?? null;
            $usuarioId = (int)($relacion['usuarioId'] ?? 0);
            $codigoPrincipal = trim((string)($relacion['codigoPrincipal'] ?? $codigo));
            $vendedor = trim((string)($relacion['vendedor'] ?? ''))
                ?: trim((string)($ventaCodigo['descripcion'] ?? ''))
                ?: ($descripcionPorCodigo[$codigoKey] ?? $codigo);
            $grupo = $relacion !== null
                ? trim((string)($grupoPorUsuario[$usuarioId] ?? 'TEXPRO INTERNO'))
                : 'TEXPRO INTERNO';
            $vendedorKey = $usuarioId > 0 ? 'usuario:' . $usuarioId : 'codigo:' . $codigoKey;

            if (!isset($unidades[$grupo])) {
                $unidades[$grupo] = [
                    'vendedores' => [],
                ];
            }
            if (!isset($unidades[$grupo]['vendedores'][$vendedorKey])) {
                $unidades[$grupo]['vendedores'][$vendedorKey] = [
                    'codigoPrincipal' => $codigoPrincipal,
                    'vendedor' => $vendedor,
                    'codigos' => [],
                ];
            }
            if (!isset($unidades[$grupo]['vendedores'][$vendedorKey]['codigos'][$codigoKey])) {
                $unidades[$grupo]['vendedores'][$vendedorKey]['codigos'][$codigoKey] = [
                    'codigo' => $codigo,
                    'descripcion' => trim((string)($ventaCodigo['descripcion'] ?? ''))
                        ?: ($descripcionPorCodigo[$codigoKey] ?? $vendedor),
                    'neto' => (int)round((float)$ventaCodigo['neto']),
                ];
            }
        }

        $items = [];
        $codigosUnicos = [];
        $vendedoresUnicos = [];
        foreach ($unidades as $nombreUnidad => $unidad) {
            $vendedores = [];
            foreach ($unidad['vendedores'] as $vendedorKey => $vendedor) {
                $codigos = [];
                $totalVendedor = 0;
                foreach ($vendedor['codigos'] as $codigoRow) {
                    $netoCodigo = (int)$codigoRow['neto'];
                    $codigos[] = [
                        'codigo' => $codigoRow['codigo'],
                        'descripcion' => $codigoRow['descripcion'],
                        'neto' => $netoCodigo,
                    ];
                    $totalVendedor += $netoCodigo;
                    $codigosUnicos[$this->normalizeCode($codigoRow['codigo'])] = true;
                }
                usort($codigos, static fn(array $a, array $b): int => ($b['neto'] <=> $a['neto']) ?: strcmp($a['codigo'], $b['codigo']));
                $vendedores[] = [
                    'codigoPrincipal' => $vendedor['codigoPrincipal'],
                    'vendedor' => $vendedor['vendedor'],
                    'neto' => $totalVendedor,
                    'cantidadCodigos' => count($codigos),
                    'codigos' => $codigos,
                ];
                $vendedoresUnicos[$vendedorKey] = true;
            }
            $totalUnidad = (int)array_sum(array_column($vendedores, 'neto'));
            foreach ($vendedores as &$vendedor) {
                $vendedor['participacion'] = $this->participacion((float)$vendedor['neto'], (float)$totalUnidad);
                foreach ($vendedor['codigos'] as &$codigo) {
                    $codigo['participacion'] = $this->participacion((float)$codigo['neto'], (float)$vendedor['neto']);
                }
                unset($codigo);
            }
            unset($vendedor);
            usort($vendedores, static fn(array $a, array $b): int => ($b['neto'] <=> $a['neto']) ?: strcmp($a['vendedor'], $b['vendedor']));
            $items[] = [
                'grupo' => $nombreUnidad,
                'total' => $totalUnidad,
                'vendedores' => $vendedores,
            ];
        }

        usort($items, static fn(array $a, array $b): int => ($b['total'] <=> $a['total']) ?: strcmp($a['grupo'], $b['grupo']));
        $total = (int)array_sum(array_column($items, 'total'));
        $resumenUnidades = [];
        foreach ($items as &$item) {
            $item['participacion'] = $this->participacion((float)$item['total'], (float)$total);
            $resumenUnidades[] = [
                'unidad' => $item['grupo'],
                'venta' => $item['total'],
                'participacion' => $item['participacion'],
            ];
        }
        unset($item);

        return [
            'total' => $total,
            'cantidadUnidades' => count($items),
            'cantidadVendedores' => count($vendedoresUnicos),
            'cantidadCodigos' => count($codigosUnicos),
            'resumenUnidades' => $resumenUnidades,
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
        $saleExpression = $this->commercialAmountSql('enc.Tipo', 'enc.SubTotal');
        $rows = $this->softlandRows(
            "
            SELECT YEAR(enc.Fecha) AS anio, MONTH(enc.Fecha) AS mes, ROUND(SUM($saleExpression), 0) AS ventas
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
        if ($unavailable = $this->softlandUnavailable('el resumen comercial')) {
            return $unavailable;
        }

        $hoy = new DateTimeImmutable('now');
        $mesLimite = $anio === (int)$hoy->format('Y') ? (int)$hoy->format('n') : 12;

        $comparativa = $this->compararVentasAnuales($anio, $mesLimite);
        $descuento = $this->obtenerMontosDescuento($anio, $mesLimite);
        $categorySaleExpression = $this->commercialAmountSql('enc.Tipo', 'm.TotLinea');
        $categoriasRows = $this->softlandRows(
            "
            SELECT RTRIM(prod.CtaVentas) AS cuentaCategoria, ROUND(SUM($categorySaleExpression), 0) AS venta
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
        foreach ($rows as $row) {
            $venta = (float)($row['venta'] ?? 0);
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

        $vendedores = $this->monthlyVendorSummary($this->monthlyVendorSalesRows($anio, $mes), $anio, $mes);
        $cumplimientoVendedores = $this->cumplimientoVendedoresResumen($vendedores['items']);
        $metaMes = array_sum(array_map(
            static fn(array $item): float => (float)($item['meta'] ?? 0),
            $vendedores['items']
        ));
        $ventaMes = (float)($descuento['montoVenta'] ?? 0);

        return [
            'ok' => true,
            'data' => [
                'anio' => $anio,
                'mes' => $mes,
                'ventaMes' => (int)round($ventaMes),
                'montoVenta' => (int)round($ventaMes),
                'meta' => $metaMes > 0 ? (int)round($metaMes) : null,
                'metaMes' => $metaMes > 0 ? (int)round($metaMes) : null,
                'cumplimiento' => $metaMes > 0 ? round(($ventaMes / $metaMes) * 100, 2) : null,
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
                'cumplimientoVendedores' => $cumplimientoVendedores,
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
        $saleExpression = $this->commercialAmountSql('enc.Tipo', 'mov.TotLinea');
        $ventasRows = $this->softlandRows(
            "
            SELECT
                RTRIM(enc.CodVendedor) AS codigoVendedor,
                COALESCE(RTRIM(vend.VenDes), RTRIM(enc.CodVendedor)) AS descripcion,
                ROUND(SUM($saleExpression), 0) AS neto
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

        $relationCodes = array_column($this->loadVendorRelations(), 'codigoAsociado');
        $ventasRows = array_map(static fn(array $row): array => [
            'codigoVendedor' => $row['codigoVendedor'] ?? '',
            'descripcion' => $row['nombreVendedor'] ?? $row['codigoVendedor'] ?? '',
            'neto' => $row['venta'] ?? 0,
        ], $this->analytics->applySharedSalesToVendorRows($ventasRows, $mes, $anio, $relationCodes));

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
                'resumenUnidades' => $estadisticas['resumenUnidades'],
                'grupos' => $estadisticas['grupos'],
            ],
        ];
    }
}
