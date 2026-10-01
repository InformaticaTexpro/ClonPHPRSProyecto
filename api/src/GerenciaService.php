<?php
declare(strict_types=1);

require_once __DIR__ . '/ConcursoPromediosService.php';
require_once __DIR__ . '/ConcursoCierreStore.php';
require_once __DIR__ . '/ConcursoReglasMeta.php';

final class GerenciaService
{
    use SharedServiceHelpers;

    private ?array $vendorRelations = null;

    public function __construct(private Database $db, private AnalyticsService $analytics)
    {
    }

    public function route(array $payload, string $method, string $path, array $query, array $body): array
    {
        if ($method === 'POST' && in_array($path, ['/comercial/concurso-ventas/cerrar', '/comercial/concurso-ventas/reabrir'], true)) {
            (new ConcursoPromediosService($this->db, $this->analytics))->assertAccess($payload);
        } else {
            $this->assertGerenciaOrAdmin($payload);
        }

        return match (true) {
            $method === 'GET' && $path === '/comercial/concurso-ventas/resumen' => $this->concursoCumplimiento($query),
            $method === 'GET' && $path === '/comercial/concurso-ventas/clientes' => $this->concursoDetalleClientes($query),
            $method === 'GET' && $path === '/comercial/concurso-ventas/productos' => $this->concursoDetalleProductos($query),
            $method === 'POST' && $path === '/comercial/concurso-ventas/cerrar' => $this->concursoCerrar($payload, $body),
            $method === 'POST' && $path === '/comercial/concurso-ventas/reabrir' => $this->concursoReabrir($payload, $body),
            $method === 'GET' && $path === '/comercial/control-muestras' => $this->controlMuestras($query, false),
            $method === 'GET' && $path === '/comercial/control-muestras/vendedor-detalle' => $this->controlMuestras($query, true),
            $method === 'GET' && $path === '/comercial/dashboard/cliente-detalle' => $this->detalleClienteComercial($query),
            $method === 'GET' && $path === '/comercial/dashboard/producto-detalle' => $this->detalleProductoComercial($query),
            $method === 'GET' && $path === '/comercial/resumen' => $this->resumenComercial($query),
            $method === 'GET' && $path === '/comercial/mensual' => $this->mensualComercial($query),
            $method === 'GET' && $path === '/comercial/guias-pendientes' => $this->guiasPendientesGlobal($query),
            $method === 'GET' && $path === '/comercial/estadisticas-ventas' => $this->estadisticasVentas($query),
            $method === 'GET' && $path === '/comercial/vendedores-principales' => $this->vendedoresPrincipales(),
            $method === 'GET' && $path === '/comercial/ventas-vendedor/cotizaciones' => $this->cotizacionesVendedor($query),
            $method === 'GET' && $path === '/comercial/ventas-vendedor/guias-pendientes' => $this->guiasPendientesVendedor($query),
            $method === 'GET' && $path === '/comercial/ventas-vendedor/clientes-nuevos' => $this->clientesNuevosVendedor($query),
            $method === 'GET' && $path === '/comercial/ventas-vendedor/muestras-detalle' => $this->muestrasDetalleVendedor($query),
            $method === 'GET' && $path === '/comercial/ventas-vendedor' => $this->ventasVendedor($query),
            default => throw new RuntimeException('Ruta de gerencia no encontrada', 404),
        };
    }

    public function concursoPuntajeUsuario(array $payload, array $query): ?array
    {
        $userId = $this->currentUserIdFromPayload($payload);
        $resumen = $this->concursoCumplimiento($query);

        foreach ($resumen['items'] ?? [] as $item) {
            if ((int)($item['usuarioId'] ?? 0) !== $userId) {
                continue;
            }

            return [
                'puntos' => $item['acumulado'] ?? $item['totalMes'] ?? 0,
                'puntosMes' => $item['totalMes'] ?? 0,
                'puntosMeta' => $item['puntosMeta'] ?? 0,
                'puntosNuevos' => $item['puntosNuevos'] ?? 0,
                'puntosRecuperados' => $item['puntosRecuperados'] ?? 0,
                'productosPuntos' => $item['productosPuntos'] ?? null,
                'productosEstadoBase' => $item['productosEstadoBase'] ?? null,
                'estadoMes' => $resumen['estadoMes'] ?? null,
                'historialMensual' => $item['mesesOficiales'] ?? [],
            ];
        }

        return null;
    }

    public function concursoDetalleUsuario(array $payload, array $query): array
    {
        $userId = $this->currentUserIdFromPayload($payload);
        $resumen = $this->concursoCumplimiento($query);
        foreach ($resumen['items'] ?? [] as $item) {
            if ((int)($item['usuarioId'] ?? 0) === $userId) {
                return [
                    'ok' => true,
                    'row' => $item,
                    'rendered' => ['mes' => $resumen['mes'], 'anio' => $resumen['anio']],
                    'estadoMes' => $resumen['estadoMes'] ?? null,
                ];
            }
        }
        return ['ok' => true, 'row' => null, 'rendered' => ['mes' => $resumen['mes'], 'anio' => $resumen['anio']], 'estadoMes' => $resumen['estadoMes'] ?? null];
    }

    public function concursoClientesUsuario(array $payload, array $query): array
    {
        $query['vendedorId'] = (string)$this->currentUserIdFromPayload($payload);
        return $this->concursoDetalleClientes($query);
    }

    public function concursoProductosUsuario(array $payload, array $query): array
    {
        $query['vendedorId'] = (string)$this->currentUserIdFromPayload($payload);
        return $this->concursoDetalleProductos($query);
    }

    public static function evaluarMetaConcurso(float $meta, float $venta, ?array $reglas = null): array
    {
        return ConcursoReglasMeta::evaluate($meta, $venta, $reglas);
    }

    private function concursoCumplimiento(array $query): array
    {
        $current = $this->concursoResumenMes($query);
        $month = $current['mes'];
        if ($month < 10) {
            foreach ($current['items'] as &$vendor) {
                $vendor['acumulado'] = null;
                $vendor['mesesOficiales'] = [];
            }
            unset($vendor);
            $current['puntosAcumulados'] = null;
            return $current;
        }
        if (($current['estadoMes'] ?? null) === 'CERRADO') {
            $store = new ConcursoCierreStore();
            for ($previousMonth = 10; $previousMonth < $month; $previousMonth++) {
                if (($store->load($previousMonth)['estado'] ?? null) !== 'CERRADO') {
                    throw new RuntimeException('SNAPSHOT OFICIAL INVÁLIDO: existe un mes anterior abierto.', 409);
                }
            }
        }
        $monthly = [];
        for ($officialMonth = 10; $officialMonth <= min($month, 12); $officialMonth++) {
            $monthly[$officialMonth] = $officialMonth === $month
                ? $current : $this->concursoResumenMes(['anio' => '2026', 'mes' => (string)$officialMonth]);
        }
        $totals = $breakdown = [];
        foreach ($monthly as $officialMonth => $result) {
            foreach ($result['items'] as $item) {
                $id = $item['usuarioId'];
                $previous = array_key_exists($id, $totals) ? $totals[$id] : 0;
                $accumulated = $previous === null || $item['totalMes'] === null ? null : $previous + $item['totalMes'];
                $totals[$id] = $accumulated;
                $breakdown[$id][] = ['mes' => $officialMonth, 'tipo' => $item['tipo'],
                    'puntosMeta' => $item['puntosMeta'], 'puntosNuevos' => $item['puntosNuevos'],
                    'puntosRecuperados' => $item['puntosRecuperados'], 'productosPuntos' => $item['productosPuntos'],
                    'totalMes' => $item['totalMes'], 'acumulado' => $accumulated];
            }
        }
        $allComplete = true;
        foreach ($current['items'] as &$vendor) {
            $id = $vendor['usuarioId'];
            $vendor['mesesOficiales'] = $breakdown[$id] ?? [];
            $vendor['acumulado'] = $totals[$id] ?? null;
            if ($vendor['acumulado'] === null) $allComplete = false;
        }
        unset($vendor);
        $current['puntosAcumulados'] = $allComplete ? array_sum(array_column($current['items'], 'acumulado')) : null;
        return $current;
    }

    private function concursoResumenMes(array $query): array
    {
        if ((string)($query['anio'] ?? '') !== '2026' || !preg_match('/^(?:[1-9]|1[0-2])$/', (string)($query['mes'] ?? ''))) {
            throw new RuntimeException('Seleccione un mes válido del año 2026.', 400);
        }
        $mes = (int)$query['mes'];
        if ($mes >= 10) {
            $saved = (new ConcursoCierreStore())->load($mes);
            if (($saved['estado'] ?? null) === 'CERRADO') return $this->concursoResumenCerrado($saved, $mes);
        }
        $reglasMeta = ConcursoReglasMeta::load();
        $desde = sprintf('2026-%02d-01', $mes);
        $hasta = (new DateTimeImmutable($desde))->modify('+1 month')->format('Y-m-d');
        $relations = $this->loadVendorRelations();
        $vendors = $owners = [];
        foreach ($relations as $r) {
            $id = $r['usuarioId'];
            $vendors[$id] ??= ['usuarioId' => $id, 'vendedor' => $r['vendedor'], 'codigoPrincipal' => $r['codigoPrincipal'], 'meta' => 0.0,
                'venta' => 0.0, 'desgloseVenta' => ['baseAsociada' => 0.0, 'compartidaRecibida' => 0.0, 'compartidaCedida' => 0.0]];
            $owners[$this->normalizeCode($r['codigoAsociado'])][$id] = true;
        }
        if (!$vendors) return ['ok' => true, 'mes' => $mes, 'anio' => 2026, 'items' => [], 'puntosParciales' => 0,
            'reglasMeta' => ['schemaVersion' => $reglasMeta['schemaVersion'], 'version' => $reglasMeta['version'], 'fechaActualizacion' => $reglasMeta['fechaActualizacion']]];
        // Misma prioridad que AnalyticsService::fetchMetaMes: mensual, luego anual sin prorratear.
        $metas = $this->db->fetchAll("SELECT usuario_id, meta FROM vendedor_meta
            WHERE COALESCE(activo, 1) = 1 AND ((tipo_periodo = 'mensual' AND fecha = ?)
                OR (tipo_periodo = 'anual' AND fecha >= '2026-01-01' AND fecha < '2027-01-01'))
            ORDER BY CASE WHEN tipo_periodo = 'mensual' THEN 0 ELSE 1 END, fecha ASC, id ASC", [$desde]);
        $assigned = [];
        foreach ($metas as $m) {
            $id = (int)$m['usuario_id'];
            if (isset($vendors[$id]) && !isset($assigned[$id])) {
                $vendors[$id]['meta'] = (float)$m['meta'];
                $assigned[$id] = true;
            }
        }
        $expression = $this->commercialAmountSql('enc.Tipo', 'm.TotLinea');
        $rows = $this->softlandRows("SELECT LTRIM(RTRIM(enc.CodVendedor)) AS codigoVendedor, SUM($expression) AS venta
            FROM [PRODIN].[softland].[iw_gsaen] enc
            INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = enc.NroInt AND m.Tipo = enc.Tipo
            INNER JOIN [PRODIN].[softland].[iw_tprod] t ON t.CodProd = m.CodProd
            WHERE enc.Tipo IN ('F', 'N', 'D') AND enc.Estado <> 'A' AND enc.Fecha >= ? AND enc.Fecha < ?
            GROUP BY LTRIM(RTRIM(enc.CodVendedor))", [$desde, $hasta]);
        $rows = $this->analytics->applySharedSalesToVendorRows($rows, $mes, 2026,
            array_column($relations, 'codigoAsociado'), $this->vendorCodeTypeMap($relations), [$desde, $hasta]);
        foreach ($rows as $row) {
            foreach ($owners[$this->normalizeCode($row['codigoVendedor'])] ?? [] as $id => $_) {
                $vendors[$id]['venta'] += (float)$row['venta'];
                $vendors[$id]['desgloseVenta']['baseAsociada'] += (float)$row['ventaBaseAtribuida'];
                $vendors[$id]['desgloseVenta']['compartidaRecibida'] += (float)$row['ventaCompartidaRecibida'];
                $vendors[$id]['desgloseVenta']['compartidaCedida'] += (float)$row['ventaCompartidaEntregada'];
            }
        }
        $clients = $this->analytics->concursoClientes($relations, $mes);
        $periodo = sprintf('2026-%02d', $mes);
        $sales = (new ConcursoPromediosService($this->db, $this->analytics))->calcular(null, null, null, $periodo, $periodo);
        $monthly = [];
        foreach ($sales['registros'] as $row) {
            $monthly[(int)$row['usuario_id']][$row['categoria']] = (float)$row['ventas_mensuales'][$periodo];
        }
        $base = null;
        $baseError = 'BASE OFICIAL NO DISPONIBLE';
        try {
            $base = (new ConcursoBaseOficialStore())->load();
            if ($base !== null) $baseError = '';
        } catch (RuntimeException $e) {
            if (!str_starts_with($e->getMessage(), 'BASE OFICIAL INVÁLIDA')) throw $e;
            $baseError = 'BASE OFICIAL INVÁLIDA';
        }
        $bases = [];
        foreach ($base['vendedores'] ?? [] as $vendorBase) foreach ($vendorBase['categorias'] as $category => $values) {
            $bases[$vendorBase['usuarioId']][$category] = (float)$values['promedioBase'];
        }
        $allBasesAvailable = true;
        foreach ($vendors as &$vendor) {
            $vendor += self::evaluarMetaConcurso($vendor['meta'], $vendor['venta'], $reglasMeta);
            $vendor += $clients['resumen'][$vendor['usuarioId']];
            $id = $vendor['usuarioId'];
            $categories = [];
            $available = true;
            foreach (['QUIMICOS', 'ACCESORIOS', 'TRAT_AGUA', 'AEROSOLES'] as $category) {
                $hasBase = array_key_exists($category, $bases[$id] ?? []);
                $available = $available && $hasBase;
                $average = $hasBase ? $bases[$id][$category] : null;
                $sale = $monthly[$id][$category] ?? 0.0;
                $difference = $hasBase ? $sale - $average : null;
                $categories[] = ['categoria' => $category, 'promedioBase' => $average, 'ventaMes' => $sale,
                    'superacion' => $difference, 'puntos' => $hasBase ? self::puntosProductosConcurso($difference, $reglasMeta) : null];
            }
            $categorySales = array_sum(array_column($categories, 'ventaMes'));
            $otrosSale = round($vendor['venta'] - $categorySales, 2);
            $categories[] = ['categoria' => 'OTROS', 'promedioBase' => null, 'ventaMes' => $otrosSale,
                'superacion' => null, 'puntos' => 0, 'informativo' => true, 'estado' => 'NO_PUNTUA'];
            $vendor['productosEstadoBase'] = $available ? 'DISPONIBLE' : ($baseError ?: ($bases[$id] ?? false ? 'BASE INCOMPLETA' : 'BASE NO DISPONIBLE'));
            $vendor['productos'] = $categories;
            $vendor['productosPuntos'] = $available ? array_sum(array_column(array_filter($categories,
                static fn(array $category): bool => empty($category['informativo'])), 'puntos')) : null;
            $vendor['totalMes'] = $available
                ? $vendor['puntosMeta'] + $vendor['puntosNuevos'] + $vendor['puntosRecuperados'] + $vendor['productosPuntos'] : null;
            if (!$available) $allBasesAvailable = false;
        }
        unset($vendor);
        return ['ok' => true, 'mes' => $mes, 'anio' => 2026, 'items' => array_values($vendors),
            'puntosParciales' => $allBasesAvailable ? array_sum(array_column($vendors, 'totalMes')) : null,
            'fuenteBase' => 'JSON', 'versionBase' => $base['version'] ?? null,
            'periodoBase' => $base === null ? null : ['desde' => $base['periodoDesde'], 'hasta' => $base['periodoHasta']],
            'estadoMes' => $mes < 10 ? 'PRUEBA' : 'ABIERTO',
            'reglasMeta' => ['schemaVersion' => $reglasMeta['schemaVersion'], 'version' => $reglasMeta['version'], 'fechaActualizacion' => $reglasMeta['fechaActualizacion']]];
    }

    private function concursoResumenCerrado(array $saved, int $month): array
    {
        $items = [];
        foreach ($saved['snapshot']['vendedores'] as $vendor) {
            unset($vendor['clientes']);
            foreach ($vendor['productos'] as &$category) unset($category['documentos'], $category['baseMeses']);
            unset($category);
            $items[] = $vendor;
        }
        return ['ok' => true, 'mes' => $month, 'anio' => 2026, 'items' => $items,
            'puntosParciales' => array_sum(array_column($items, 'totalMes')),
            'fuenteBase' => 'JSON', 'versionBase' => $saved['baseOficial']['version'],
            'periodoBase' => ['desde' => $saved['baseOficial']['periodoDesde'], 'hasta' => $saved['baseOficial']['periodoHasta']],
            'estadoMes' => 'CERRADO', 'versionCierre' => $saved['version'], 'fechaCierre' => $saved['fechaCierre'],
            'reglasMeta' => $saved['reglasMeta'] ?? null];
    }

    private function concursoMesSolicitud(array $body): int
    {
        if ((string)($body['anio'] ?? '') !== '2026' || !preg_match('/^(?:10|11|12)$/', (string)($body['mes'] ?? ''))) {
            if ((string)($body['mes'] ?? '') === '9' || (string)($body['mes'] ?? '') === '09') {
                throw new RuntimeException('Septiembre 2026 corresponde al período de prueba y no puede cerrarse.', 400);
            }
            throw new RuntimeException('Solo pueden cerrarse Octubre, Noviembre y Diciembre de 2026.', 400);
        }
        return (int)$body['mes'];
    }

    private function concursoActor(array $payload): array
    {
        $id = $this->currentUserIdFromPayload($payload);
        $user = $this->db->fetchOne('SELECT nombre FROM usuario WHERE id = ? AND is_active = 1', [$id]);
        if (!$user) throw new RuntimeException('Usuario no disponible.', 403);
        return ['usuarioId' => $id, 'nombre' => (string)$user['nombre']];
    }

    private function concursoCerrar(array $payload, array $body): array
    {
        $month = $this->concursoMesSolicitud($body);
        $store = new ConcursoCierreStore();
        $actor = $this->concursoActor($payload);
        return $store->locked(function () use ($month, $store, $actor): array {
            $previous = $store->load($month);
            if (($previous['estado'] ?? null) === 'CERRADO') throw new RuntimeException('El mes ya está cerrado.', 409);
            for ($before = 10; $before < $month; $before++) {
                if (($store->load($before)['estado'] ?? null) !== 'CERRADO') {
                    $name = ['Octubre', 'Noviembre', 'Diciembre'][$before - 10];
                    throw new RuntimeException("Debe cerrar $name 2026 antes de cerrar este mes.", 409);
                }
            }
            $base = (new ConcursoBaseOficialStore())->load();
            if ($base === null) throw new RuntimeException('BASE OFICIAL NO DISPONIBLE: no se puede cerrar el mes.', 409);
            $baseById = [];
            foreach ($base['vendedores'] as $vendor) $baseById[$vendor['usuarioId']] = $vendor;
            $summary = $this->concursoResumenMes(['anio' => '2026', 'mes' => (string)$month]);
            if (!$summary['items']) throw new RuntimeException('No hay vendedores para cerrar.', 409);
            if ($summary['puntosParciales'] === null || $summary['versionBase'] !== $base['version']) {
                throw new RuntimeException('Base oficial incompleta o modificada durante el cálculo.', 409);
            }
            $relations = $this->loadVendorRelations();
            $period = sprintf('2026-%02d', $month);
            $calculator = new ConcursoPromediosService($this->db, $this->analytics);
            $vendors = [];
            foreach ($summary['items'] as $item) {
                $id = $item['usuarioId'];
                $vendorBase = $baseById[$id] ?? null;
                if ($vendorBase === null || count($vendorBase['categorias']) !== 4) {
                    throw new RuntimeException('Vendedor sin las cuatro categorías de Base Oficial.', 409);
                }
                if ($item['productosPuntos'] === null || $item['totalMes'] === null) {
                    throw new RuntimeException('Productos o Total Mes incompletos.', 409);
                }
                $clientResult = $this->analytics->concursoClientes($relations, $month, $id, null, true);
                $item['clientes'] = ['nuevos' => [], 'recuperados' => []];
                foreach ($clientResult['clientes'] as $client) {
                    $kind = $client['categoria'];
                    if (!isset($item['clientes'][$kind])) throw new RuntimeException('Categoría de cliente inválida.', 409);
                    $item['clientes'][$kind][] = $client;
                }
                foreach ($item['productos'] as &$category) {
                    $name = $category['categoria'];
                    if ($name === 'OTROS' || !empty($category['informativo'])) continue;
                    $values = $vendorBase['categorias'][$name] ?? null;
                    if ($values === null) throw new RuntimeException('Categoría de Base Oficial faltante.', 409);
                    if (abs((float)$values['promedioBase'] - (float)$category['promedioBase']) > .011) {
                        throw new RuntimeException('La Base Oficial cambió durante el cálculo.', 409);
                    }
                    $category['baseMeses'] = array_map('floatval', $values['meses']);
                    $detail = $calculator->calcular($id, $name, $month, $period, $period);
                    if (abs((float)$detail['total'] - (float)$category['ventaMes']) > .011) {
                        throw new RuntimeException('El detalle de productos no coincide con la venta mensual.', 409);
                    }
                    $category['documentos'] = $detail['documentos'];
                }
                unset($category);
                $item['productos'] = array_values(array_filter($item['productos'],
                    static fn(array $category): bool => $category['categoria'] !== 'OTROS' && empty($category['informativo'])));
                $vendors[] = $item;
            }
            if ((new ConcursoBaseOficialStore())->load() !== $base) {
                throw new RuntimeException('La Base Oficial cambió durante el cierre.', 409);
            }
            $data = ['schemaVersion' => 1, 'anioConcurso' => 2026, 'periodo' => $period,
                'estado' => 'CERRADO', 'version' => ($previous['version'] ?? 0) + 1,
                'fechaCierre' => date(DATE_ATOM), 'fechaReapertura' => null,
                'cerradoPor' => $actor, 'reabiertoPor' => null,
                'baseOficial' => ['version' => $base['version'], 'periodoDesde' => $base['periodoDesde'], 'periodoHasta' => $base['periodoHasta']],
                'reglasMeta' => $summary['reglasMeta'],
                'parametros' => ['schemaVersion' => $summary['reglasMeta']['schemaVersion'],
                    'version' => $summary['reglasMeta']['version']],
                'snapshot' => ['vendedores' => $vendors]];
            $saved = $store->save($data, $month);
            return ['ok' => true, 'estadoMes' => 'CERRADO', 'versionCierre' => $saved['version'], 'fechaCierre' => $saved['fechaCierre']];
        });
    }

    private function concursoReabrir(array $payload, array $body): array
    {
        $month = $this->concursoMesSolicitud($body);
        $store = new ConcursoCierreStore();
        $actor = $this->concursoActor($payload);
        return $store->locked(function () use ($month, $store, $actor): array {
            $saved = $store->load($month);
            if (($saved['estado'] ?? null) !== 'CERRADO') throw new RuntimeException('El mes no está cerrado.', 409);
            for ($later = $month + 1; $later <= 12; $later++) {
                if (($store->load($later)['estado'] ?? null) === 'CERRADO') {
                    $name = ['Octubre', 'Noviembre', 'Diciembre'][$later - 10];
                    throw new RuntimeException("Debe reabrir $name 2026 antes de reabrir este mes.", 409);
                }
            }
            $saved['estado'] = 'ABIERTO';
            $saved['fechaReapertura'] = date(DATE_ATOM);
            $saved['reabiertoPor'] = $actor;
            $saved = $store->save($saved, $month);
            return ['ok' => true, 'estadoMes' => 'ABIERTO', 'versionCierre' => $saved['version']];
        });
    }

    public static function puntosProductosConcurso(float $superacion, ?array $parametros = null): int
    {
        return ConcursoReglasMeta::productPoints($superacion, $parametros);
    }

    private function concursoDetalleProductos(array $query): array
    {
        if ((string)($query['anio'] ?? '') !== '2026' || !preg_match('/^(?:[1-9]|1[0-2])$/', (string)($query['mes'] ?? ''))) {
            throw new RuntimeException('Seleccione un mes válido del año 2026.', 400);
        }
        $id = Security::validate_id($query['vendedorId'] ?? null);
        $category = (string)($query['categoria'] ?? '');
        if (!in_array($category, ['QUIMICOS', 'ACCESORIOS', 'TRAT_AGUA', 'AEROSOLES', 'OTROS'], true)) throw new RuntimeException('Categoría inválida.', 400);
        $detail = $query['detalle'] ?? '';
        if (!in_array($detail, ['base', 'venta'], true)) throw new RuntimeException('Detalle inválido.', 400);
        $mes = (int)$query['mes'];
        if ($category === 'OTROS' && $detail === 'base') {
            return ['ok' => true, 'meses' => [], 'fuenteBase' => 'INFORMATIVO'];
        }
        if ($mes >= 10 && $category !== 'OTROS') {
            $saved = (new ConcursoCierreStore())->load($mes);
            if (($saved['estado'] ?? null) === 'CERRADO') {
                foreach ($saved['snapshot']['vendedores'] as $vendor) if ($vendor['usuarioId'] === $id) {
                    foreach ($vendor['productos'] as $product) if ($product['categoria'] === $category) {
                        if ($detail === 'venta') return ['ok' => true, 'documentos' => $product['documentos'], 'total' => $product['ventaMes']];
                        $months = [];
                        foreach ($product['baseMeses'] as $period => $sale) $months[] = ['periodo' => $period, 'venta' => $sale];
                        return ['ok' => true, 'meses' => $months, 'promedioBase' => $product['promedioBase'],
                            'fuenteBase' => 'JSON', 'versionBase' => $saved['baseOficial']['version']];
                    }
                }
                throw new RuntimeException('Vendedor no encontrado en el snapshot oficial.', 404);
            }
        }
        if (!in_array($id, array_column($this->loadVendorRelations(), 'usuarioId'), true)) throw new RuntimeException('Vendedor no encontrado.', 404);
        if ($detail === 'base') {
            $base = (new ConcursoBaseOficialStore())->load();
            $vendorBase = null;
            foreach ($base['vendedores'] ?? [] as $row) if ($row['usuarioId'] === $id) { $vendorBase = $row; break; }
            $values = $vendorBase['categorias'][$category] ?? null;
            if ($values === null) return ['ok' => true, 'meses' => [], 'fuenteBase' => 'JSON'];
            $months = [];
            foreach ($values['meses'] as $period => $sale) $months[] = ['periodo' => $period, 'venta' => (float)$sale];
            return ['ok' => true, 'meses' => $months, 'promedioBase' => (float)$values['promedioBase'],
                'fuenteBase' => 'JSON', 'versionBase' => $base['version']];
        }
        $periodo = sprintf('2026-%02d', $mes);
        $result = (new ConcursoPromediosService($this->db, $this->analytics))->calcular($id, $category, $mes, $periodo, $periodo);
        return ['ok' => true, 'documentos' => $result['documentos'], 'total' => $result['total']];
    }

    private function concursoDetalleClientes(array $query): array
    {
        if ((string)($query['anio'] ?? '') !== '2026' || !preg_match('/^(?:[1-9]|1[0-2])$/', (string)($query['mes'] ?? ''))) {
            throw new RuntimeException('Seleccione un mes válido del año 2026.', 400);
        }
        $id = Security::validate_id($query['vendedorId'] ?? null);
        $kind = $query['categoria'] ?? '';
        if (!in_array($kind, ['nuevos', 'recuperados'], true)) throw new RuntimeException('Categoría inválida.', 400);
        $client = isset($query['cliente']) ? $this->validarCodigoDetalle($query['cliente']) : null;
        $mes = (int)$query['mes'];
        if ($mes >= 10) {
            $saved = (new ConcursoCierreStore())->load($mes);
            if (($saved['estado'] ?? null) === 'CERRADO') {
                foreach ($saved['snapshot']['vendedores'] as $vendor) if ($vendor['usuarioId'] === $id) {
                    $rows = $vendor['clientes'][$kind];
                    if ($client !== null) $rows = array_values(array_filter($rows, static fn(array $row): bool => $row['clienteCodigo'] === $client));
                    return ['ok' => true, 'clientes' => $rows];
                }
                throw new RuntimeException('Vendedor no encontrado en el snapshot oficial.', 404);
            }
        }
        $relations = $this->loadVendorRelations();
        if (!in_array($id, array_column($relations, 'usuarioId'), true)) throw new RuntimeException('Vendedor no encontrado.', 404);
        $result = $this->analytics->concursoClientes($relations, (int)$query['mes'], $id, $client);
        $items = array_values(array_filter($result['clientes'], static fn(array $row): bool => $row['categoria'] === $kind));
        return ['ok' => true, 'clientes' => $items];
    }

    private function validarCodigoDetalle(mixed $valor): string
    {
        if (!is_string($valor) || trim($valor) === '' || strlen($valor) > 100 || preg_match('/[\x00-\x1F\x7F]/', $valor)) {
            throw new RuntimeException('Debe indicar un codigo valido.', 400);
        }
        return trim($valor);
    }

    private function periodoDetalle(array $query): array
    {
        foreach (['anio', 'mes'] as $campo) {
            if (filter_var($query[$campo] ?? null, FILTER_VALIDATE_INT) === false) {
                throw new RuntimeException('Debe indicar un periodo valido.', 400);
            }
        }
        return $this->monthRange($this->validarAnio($query['anio']), $this->validarMes($query['mes']));
    }

    private function detalleClienteComercial(array $query): array
    {
        $codigo = $this->validarCodigoDetalle($query['codigoCliente'] ?? null);
        [$desde, $hasta] = $this->periodoDetalle($query);
        $monto = $this->commercialAmountSql('enc.Tipo', 'enc.SubTotal');
        $items = $this->softlandRows(
            "SELECT LTRIM(RTRIM(enc.CodVendedor)) AS codigoVendedor,
                    COALESCE(NULLIF(LTRIM(RTRIM(vend.VenDes)), ''), LTRIM(RTRIM(enc.CodVendedor))) AS vendedor,
                    enc.Tipo AS tipo, CONVERT(varchar(50), enc.Folio) AS folio,
                    CONVERT(decimal(38, 2), $monto) AS monto
             FROM [PRODIN].[softland].[iw_gsaen] enc
             LEFT JOIN [PRODIN].[softland].[cwtvend] vend ON vend.VenCod = enc.CodVendedor
             WHERE LTRIM(RTRIM(enc.CodAux)) = ?
               AND enc.Fecha >= ? AND enc.Fecha < ?
               AND enc.Tipo IN ('F', 'N', 'D') AND enc.Estado <> 'A'
             ORDER BY enc.Fecha DESC, enc.Folio DESC",
            [$codigo, $desde, $hasta]
        );
        foreach ($items as &$item) {
            $item['monto'] = (float)$item['monto'];
        }
        unset($item);
        return ['ok' => true, 'items' => $items, 'total' => array_sum(array_column($items, 'monto'))];
    }

    private function detalleProductoComercial(array $query): array
    {
        $codigo = $this->validarCodigoDetalle($query['codigoProducto'] ?? null);
        [$desde, $hasta] = $this->periodoDetalle($query);
        $venta = $this->commercialAmountSql('enc.Tipo', 'mov.TotLinea');
        $rows = $this->softlandRows(
            "SELECT LTRIM(RTRIM(enc.CodVendedor)) AS codigoVendedor,
                    COALESCE(NULLIF(LTRIM(RTRIM(vend.VenDes)), ''), LTRIM(RTRIM(enc.CodVendedor))) AS vendedorAsociado,
                    SUM(CONVERT(decimal(38, 6), $venta)) AS venta
             FROM [PRODIN].[softland].[iw_gsaen] enc
             INNER JOIN [PRODIN].[softland].[iw_gmovi] mov ON mov.NroInt = enc.NroInt AND mov.Tipo = enc.Tipo
             LEFT JOIN [PRODIN].[softland].[cwtvend] vend ON vend.VenCod = enc.CodVendedor
             WHERE LTRIM(RTRIM(mov.CodProd)) = ?
               AND enc.Fecha >= ? AND enc.Fecha < ?
               AND enc.Tipo IN ('F', 'N', 'D') AND enc.Estado <> 'A'
             GROUP BY LTRIM(RTRIM(enc.CodVendedor)), vend.VenDes",
            [$codigo, $desde, $hasta]
        );
        $relations = [];
        foreach ($this->loadVendorRelations() as $relation) {
            $relations[mb_strtoupper($relation['codigoAsociado'])][$relation['usuarioId']] = $relation;
        }
        $groups = [];
        foreach ($rows as $row) {
            $code = trim((string)$row['codigoVendedor']);
            $owners = $relations[mb_strtoupper($code)] ?? [];
            ksort($owners);
            // Una relacion multiple identifica a todos los principales, sin duplicar la venta global.
            $key = $owners ? 'usuarios:' . implode(',', array_keys($owners)) : 'codigo:' . $code;
            $name = $owners ? implode(' / ', array_map(
                static fn(array $owner): string => $owner['vendedor'] . ' (' . $owner['codigoPrincipal'] . ')',
                $owners
            )) : ((string)$row['vendedorAsociado'] ?: $code);
            $groups[$key] ??= ['vendedorPrincipal' => $name, 'venta' => 0.0, 'codigos' => []];
            $row['venta'] = (float)$row['venta'];
            $groups[$key]['venta'] += $row['venta'];
            $groups[$key]['codigos'][] = $row;
        }
        $items = array_values($groups);
        foreach ($items as &$item) {
            usort($item['codigos'], static fn(array $a, array $b): int => ($b['venta'] <=> $a['venta']) ?: strcmp($a['codigoVendedor'], $b['codigoVendedor']));
        }
        unset($item);
        usort($items, static fn(array $a, array $b): int => ($b['venta'] <=> $a['venta']) ?: strcmp($a['vendedorPrincipal'], $b['vendedorPrincipal']));
        return ['ok' => true, 'items' => $items, 'total' => array_sum(array_column($items, 'venta'))];
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
        $dashboard = $this->analytics->dashboardForUser($usuarioId, ['anio' => $anio, 'mes' => $mes]);
        // Solo ocultar codigos sin venta neta en la tabla mensual de Gerencia.
        // Conservar las compartidas, las ventas negativas y los totales del motor de Ventas.
        $dashboard['vendedores'] = array_values(array_filter(
            $dashboard['vendedores'] ?? [],
            static fn(array $row): bool => (bool)($row['esAsignada'] ?? false)
                || abs((float)($row['totalVentasCobrado'] ?? 0)) >= 0.000001
        ));

        $dashboard['muestras'] = $this->muestrasVendedor($usuarioId, $mes, $anio);

        return $dashboard;
    }

    private function muestrasVendedor(int $usuarioId, int $mes, int $anio): array
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
        [$fuenteSql, $fuenteParams] = $this->muestrasFuenteSql($codigos, '2022-01-01', null);
        // Solo Muestras consulta TEXPRO18. Conservar los signos originales de ambas fuentes.
        $stmt = $this->db->softland()->prepare(
            "$fuenteSql
             SELECT COALESCE(SUM(Total), 0) AS montoHistorico,
                COUNT(DISTINCT CONCAT(Tipo, '|', Folio)) AS foliosHistoricos,
                COALESCE(SUM(CASE WHEN Fecha >= ? AND Fecha < ? THEN Total ELSE 0 END), 0) AS montoMes,
                COUNT(DISTINCT CASE WHEN Fecha >= ? AND Fecha < ? THEN CONCAT(Tipo, '|', Folio) END) AS foliosMes
             FROM MuestrasFuente"
        );
        $stmt->execute(array_merge($fuenteParams, [$desde, $hasta, $desde, $hasta]));
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        return [
            'historico' => [
                'monto' => (float)$row['montoHistorico'],
                'folios' => (int)$row['foliosHistoricos'],
            ],
            'mes' => [
                'monto' => (float)$row['montoMes'],
                'folios' => (int)$row['foliosMes'],
            ],
            'composicion' => $this->muestrasComposicionVendedor($codigos, (float)$row['montoHistorico']),
            'topProductosHistorico' => $this->muestrasTopProductosVendedor($codigos, (float)$row['montoHistorico']),
            'valorComercialMes' => $this->muestrasValorComercialMes($codigos, $desde, $hasta),
        ];
    }

    private function muestrasValorComercialMes(array $codigos, string $desde, string $hasta): float
    {
        [$fuenteSql, $params] = $this->muestrasFuenteSql($codigos, $desde, $hasta);
        $precioProdin = $this->muestrasPrecioProdinSql('P.CodProd');
        // Precio de referencia PRODIN; documentos y cantidades siguen siendo TEXPRO18.
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
        return (float)$row['valorComercialMes'];
    }

    private function muestrasPrecioProdinSql(string $codProdSql = 'M.CodProd'): string
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

    /** Fuente normalizada de Muestras; $hasta es exclusivo. */
    private function muestrasFuenteSql(array $codigos, string $desde, ?string $hasta): array
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

    private function controlMuestras(array $query, bool $detalle): array
    {
        $usuarioId = isset($query['vendedorId']) && $query['vendedorId'] !== ''
            ? $this->validarVendedorPrincipal($query['vendedorId']) : null;
        if ($detalle && $usuarioId === null) {
            throw new RuntimeException('Debe seleccionar un vendedor valido.', 400);
        }
        // El catalogo ya contiene todas las relaciones de los usuarios activos.
        // Precargar el cache de esta request evita un SELECT por vendedor.
        $relaciones = [];
        foreach ($this->loadVendorRelations() as $relacion) {
            $id = (int)$relacion['usuarioId'];
            $relaciones[$id][] = ['cod_vendedor' => $relacion['codigoAsociado'], 'tipo' => $relacion['tipo']];
        }
        foreach ($relaciones as $id => $rows) {
            $this->vendorRelationsByUserId[$id] = $rows;
        }
        $vendedores = [];
        foreach ($this->vendedoresPrincipales()['vendedores'] as $vendedor) {
            if ($usuarioId !== null && $vendedor['usuarioId'] !== $usuarioId) continue;
            $vendedor['codigos'] = $this->normalizeVendorCodes($this->getVendorCodes($vendedor['usuarioId']));
            $vendedores[] = $vendedor;
        }
        require_once __DIR__ . '/ControlMuestrasService.php';
        $service = new ControlMuestrasService($this->db, $this->muestrasPrecioProdinSql('P.CodProd'));
        return $service->consultar($query, $vendedores, $usuarioId, $detalle);
    }

    private function muestrasComposicionVendedor(array $codigos, float $totalHistorico): array
    {
        [$fuenteSql, $params] = $this->muestrasFuenteSql($codigos, '2022-01-01', null);
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

    private function muestrasTopProductosVendedor(array $codigos, float $totalHistorico): array
    {
        [$fuenteSql, $params] = $this->muestrasFuenteSql($codigos, '2022-01-01', null);
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

    private function muestrasDetalleVendedor(array $query): array
    {
        $usuarioId = $this->validarVendedorPrincipal($query['vendedorId'] ?? null);
        $anio = $this->validarAnio($query['anio'] ?? null);
        $mes = $this->validarMes($query['mes'] ?? null);
        $codigos = $this->normalizeVendorCodes($this->getVendorCodes($usuarioId));
        if (!$codigos) return ['ok' => true, 'items' => [], 'monto' => 0, 'folios' => 0, 'valorComercialMes' => 0];
        [$desde, $hasta] = $this->monthRange($anio, $mes);
        [$fuenteSql, $params] = $this->muestrasFuenteSql($codigos, $desde, $hasta);
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
        // La identidad documental coincide con COUNT DISTINCT del resumen: Tipo + Folio.
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
            'ok' => true, 'items' => $items, 'monto' => $centavos / 100, 'folios' => count($folios),
            'valorComercialMes' => $this->muestrasValorComercialMes($codigos, $desde, $hasta),
        ];
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

    private function guiasPendientesGlobal(array $query): array
    {
        $anio = $this->validarAnio($query['anio'] ?? null);
        $mes = $this->validarMes($query['mes'] ?? null);
        return $this->analytics->pendingGuidesDetailGlobal($mes, $anio);
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
        if ($this->vendorRelations !== null) {
            return $this->vendorRelations;
        }

        $rows = $this->db->fetchAll(
            'SELECT
                u.id AS usuarioId,
                u.codigo AS codigoPrincipal,
                u.nombre AS vendedor,
                u.area AS area,
                uv.cod_vendedor AS codigoAsociado,
                uv.tipo
             FROM usuario u
             INNER JOIN usuario_vendedor uv ON uv.usuario_id = u.id
             WHERE u.is_active = 1
             ORDER BY u.nombre ASC, uv.tipo ASC, uv.cod_vendedor ASC'
        );

        $this->vendorRelations = array_map(static function (array $row): array {
            return [
                'usuarioId' => (int)($row['usuarioId'] ?? 0),
                'codigoPrincipal' => trim((string)($row['codigoPrincipal'] ?? '')),
                'vendedor' => trim((string)($row['vendedor'] ?? '')),
                'area' => trim((string)($row['area'] ?? '')),
                'codigoAsociado' => trim((string)($row['codigoAsociado'] ?? '')),
                'tipo' => strtoupper(trim((string)($row['tipo'] ?? ''))),
            ];
        }, $rows);

        return $this->vendorRelations;
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
                'tipo' => $relation['tipo'] ?? '',
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
                    'tipo' => $relation['tipo'] ?? '',
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
                    'tipo' => $codeRow['tipo'] ?? '',
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
        $relations = $this->loadVendorRelations();
        $relationCodes = array_column($relations, 'codigoAsociado');
        return $this->analytics->applySharedSalesToVendorRows(
            $rows,
            $mes,
            $anio,
            $relationCodes,
            $this->vendorCodeTypeMap($relations)
        );
    }

    private function totalVentasGlobalPeriodo(int $anio, int $mes, ?array $rango = null): float
    {
        [$desde, $hasta] = $rango ?? $this->monthRange($anio, $mes);
        $saleExpression = $this->commercialAmountSql('enc.Tipo', 'mov.TotLinea');
        $row = $this->softlandOne(
            "SELECT SUM($saleExpression) AS ventaTotal
             FROM [PRODIN].[softland].[iw_gsaen] enc
             INNER JOIN [PRODIN].[softland].[iw_gmovi] mov
                ON mov.NroInt = enc.NroInt AND mov.Tipo = enc.Tipo
             WHERE enc.Fecha >= ?
               AND enc.Fecha < ?
               AND enc.Tipo IN ('F', 'N', 'D')
               AND enc.Estado <> 'A'",
            [$desde, $hasta]
        );

        return (float)($row['ventaTotal'] ?? $row['VentaTotal'] ?? 0);
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
                    'compartidaRecibida' => 0.0,
                    'tipo' => strtoupper(trim((string)($fila['tipo'] ?? ''))),
                ];
            }
            $tieneComponentes = array_key_exists('ventaBaseAtribuida', $fila);
            $netoPropio = $tieneComponentes
                ? (float)($fila['ventaBaseAtribuida'] ?? 0) - (float)($fila['ventaCompartidaEntregada'] ?? 0)
                : (float)($fila['neto'] ?? 0);
            $ventasPorCodigo[$codigoKey]['neto'] += $netoPropio;
            $ventasPorCodigo[$codigoKey]['compartidaRecibida'] += (float)($fila['ventaCompartidaRecibida'] ?? 0);
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
                    'tipo' => $ventaCodigo['tipo'] ?? '',
                    'esCompartida' => false,
                ];
            }
            if (abs((float)($ventaCodigo['compartidaRecibida'] ?? 0)) >= 0.000001) {
                $sharedKey = '__ventas_compartidas_ta__';
                if (!isset($unidades[$grupo]['vendedores'][$vendedorKey]['codigos'][$sharedKey])) {
                    $unidades[$grupo]['vendedores'][$vendedorKey]['codigos'][$sharedKey] = [
                        'codigo' => 'VENTAS COMPARTIDAS TA',
                        'descripcion' => 'Ventas compartidas recibidas',
                        'neto' => 0,
                        'tipo' => 'TA',
                        'esCompartida' => true,
                    ];
                }
                $unidades[$grupo]['vendedores'][$vendedorKey]['codigos'][$sharedKey]['neto'] += (float)$ventaCodigo['compartidaRecibida'];
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
                    $netoCodigo = (int)round((float)$codigoRow['neto']);
                    $codigos[] = [
                        'codigo' => $codigoRow['codigo'],
                        'descripcion' => $codigoRow['descripcion'],
                        'neto' => $netoCodigo,
                        'tipo' => $codigoRow['tipo'] ?? '',
                        'esCompartida' => (bool)($codigoRow['esCompartida'] ?? false),
                    ];
                    $totalVendedor += $netoCodigo;
                    if (!(bool)($codigoRow['esCompartida'] ?? false)) {
                        $codigosUnicos[$this->normalizeCode($codigoRow['codigo'])] = true;
                    }
                }
                usort($codigos, static fn(array $a, array $b): int => ($b['neto'] <=> $a['neto']) ?: strcmp($a['codigo'], $b['codigo']));
                $vendedores[] = [
                    'codigoPrincipal' => $vendedor['codigoPrincipal'],
                    'vendedor' => $vendedor['vendedor'],
                    'neto' => $totalVendedor,
                    'cantidadCodigos' => count(array_filter(
                        $codigos,
                        static fn(array $row): bool => !(bool)($row['esCompartida'] ?? false)
                    )),
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
        $guiasPendientes = $this->analytics->pendingGuidesGlobal($mes, $anio);

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
                'guiasPendientes' => $guiasPendientes,
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
        $fechas = [];
        foreach (['desde', 'hasta'] as $campo) {
            $valor = $query[$campo] ?? null;
            $fecha = is_string($valor) ? DateTimeImmutable::createFromFormat('!Y-m-d', $valor) : false;
            if (!$fecha || $fecha->format('Y-m-d') !== $valor) {
                throw new RuntimeException('Debe indicar fechas válidas Desde y Hasta.', 400);
            }
            $fechas[$campo] = $fecha;
        }
        if ($fechas['desde'] > $fechas['hasta']) {
            throw new RuntimeException('La fecha Desde no puede ser posterior a Hasta.', 400);
        }
        $desde = $fechas['desde']->format('Ymd');
        $hastaSiguiente = $fechas['hasta']->modify('+1 day')->format('Ymd');
        $rango = [$desde, $hastaSiguiente];
        $anio = (int)$fechas['desde']->format('Y');
        $mes = (int)$fechas['desde']->format('m');
        if ($unavailable = $this->softlandUnavailable('las estadisticas de ventas')) {
            return $unavailable;
        }

        $ventaTotalGlobal = $this->totalVentasGlobalPeriodo($anio, $mes, $rango);
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
            $rango
        );

        $relaciones = $this->loadVendorRelations();
        $relationCodes = array_column($relaciones, 'codigoAsociado');
        $ventasRows = array_map(static fn(array $row): array => [
            'codigoVendedor' => $row['codigoVendedor'] ?? '',
            'descripcion' => $row['nombreVendedor'] ?? $row['codigoVendedor'] ?? '',
            'neto' => $row['venta'] ?? 0,
            'tipo' => $row['tipoCodigo'] ?? '',
            'ventaBaseAtribuida' => $row['ventaBaseAtribuida'] ?? 0,
            'ventaCompartidaRecibida' => $row['ventaCompartidaRecibida'] ?? 0,
            'ventaCompartidaEntregada' => $row['ventaCompartidaEntregada'] ?? 0,
        ], $this->analytics->applySharedSalesToVendorRows(
            $ventasRows,
            $mes,
            $anio,
            $relationCodes,
            $this->vendorCodeTypeMap($relaciones),
            [$fechas['desde']->format('Y-m-d'), $fechas['hasta']->modify('+1 day')->format('Y-m-d')]
        ));

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

        $estadisticas = $this->consolidarEstadisticasVentas($ventasRows, $gruposRows, $relaciones);

        return [
            'ok' => true,
            'data' => [
                'desde' => $fechas['desde']->format('Y-m-d'),
                'hasta' => $fechas['hasta']->format('Y-m-d'),
                'total' => (int)round($ventaTotalGlobal),
                'totalAtribuido' => $estadisticas['total'],
                'resumen' => [
                    'ventaTotal' => (int)round($ventaTotalGlobal),
                    'ventaTotalAtribuida' => $estadisticas['total'],
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
