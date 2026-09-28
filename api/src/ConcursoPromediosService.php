<?php
declare(strict_types=1);

require_once __DIR__ . '/ConcursoBaseOficialStore.php';
require_once __DIR__ . '/ConcursoCierreStore.php';
require_once __DIR__ . '/ConcursoReglasMeta.php';

final class ConcursoPromediosService
{
    use SharedServiceHelpers;
    private const CATEGORIAS = ['QUIMICOS', 'ACCESORIOS', 'TRAT_AGUA', 'AEROSOLES'];

    public function __construct(private Database $db, private AnalyticsService $analytics) {}

    public function assertAccess(array $payload): int
    {
        $id = $this->currentUserIdFromPayload($payload);
        // Mismos permisos directos/heredados activos que AuthService; sin excepciones por perfil.
        $allowed = $this->db->fetchOne(
            "SELECT u.id FROM usuario u WHERE u.id = ? AND u.is_active = 1 AND EXISTS (
                SELECT 1 FROM menu m WHERE m.codigo = 'administracion' AND m.activo = 1 AND (
                    EXISTS (SELECT 1 FROM usuario_menu um WHERE um.usuario_id = u.id AND um.menu_id = m.id AND um.activo = 1)
                    OR EXISTS (SELECT 1 FROM usuario_perfil up
                        INNER JOIN perfil p ON p.id = up.perfil_id AND p.activo = 1
                        INNER JOIN perfil_menu pm ON pm.perfil_id = p.id AND pm.activo = 1
                        WHERE up.usuario_id = u.id AND up.activo = 1 AND pm.menu_id = m.id)
                ))", [$id]
        );
        if (!$allowed) throw new RuntimeException('Sin acceso a Administración.', 403);
        return $id;
    }

    public function route(array $payload, string $method, string $path, array $query, array $body): array
    {
        $id = $this->assertAccess($payload);
        if ($method === 'GET' && $path === '/concurso-promedios/estado') return ['ok' => true] + $this->estado();
        if ($method === 'GET' && $path === '/concurso-promedios/diagnostico') return $this->diagnostico();
        if ($method === 'GET' && $path === '/concurso-promedios/parametros') {
            return ['ok' => true, 'parametros' => ConcursoReglasMeta::load()];
        }
        if ($method === 'POST' && $path === '/concurso-promedios/parametros') {
            if (!is_string($body['seccion'] ?? null) || !is_array($body['valores'] ?? null)
                || !is_int($body['version'] ?? null)) throw new RuntimeException('Cambio de parámetros incompleto.', 400);
            $before = $body['version'];
            $saved = ConcursoReglasMeta::saveSection($body['seccion'], $body['valores'], $before,
                ['usuarioId' => $id, 'nombre' => (string)($payload['nombre'] ?? '')]);
            return ['ok' => true, 'parametros' => $saved, 'cambio' => $saved['version'] !== $before];
        }
        if ($method === 'GET' && $path === '/concurso-promedios/calcular') {
            $period = self::periodo($query['desde'] ?? null, $query['hasta'] ?? null);
            $official = $this->estado();
            if ($official['oficial'] && ($query['confirmar'] ?? '') !== '1') {
                return ['ok' => false, 'code' => 'official_exists_calculate', 'periodo' => $official['periodo'],
                    'error' => 'Ya existe una base oficial del Concurso de Ventas 2026. Confirme el cálculo preliminar.'];
            }
            $result = $this->calcular(null, null, null, $period['periodo_desde'], $period['periodo_hasta']);
            $result['baseOficialExistente'] = $official['oficial'];
            $result['fechaCalculo'] = date('Y-m-d H:i:s');
            $result['revision'] = Security::jwt_encode(
                ['purpose' => 'concurso-promedios-2026', 'usuario' => $id, 'registros' => $result['registros'], 'fecha' => $result['fechaCalculo'], 'periodo' => $period],
                $this->snapshotKey(), '8h'
            );
            return ['ok' => true] + $result;
        }
        if ($method === 'GET' && $path === '/concurso-promedios/detalle') {
            $userId = Security::validate_id($query['usuarioId'] ?? null);
            $period = self::periodo($query['desde'] ?? null, $query['hasta'] ?? null);
            $monthPeriod = self::periodo($query['periodo'] ?? null, $query['periodo'] ?? null);
            $mes = (int)substr($monthPeriod['periodo_desde'], 5);
            $category = $query['categoria'] ?? '';
            if (!in_array($monthPeriod['periodo_desde'], $period['meses'], true) || !in_array($category, self::CATEGORIAS, true)) {
                throw new RuntimeException('Categoría o mes inválidos.', 400);
            }
            return ['ok' => true] + $this->calcular($userId, $category, $mes, $period['periodo_desde'], $period['periodo_hasta']);
        }
        if ($method === 'POST' && $path === '/concurso-promedios/guardar') return $this->guardar($id, $body);
        throw new RuntimeException('Ruta de promedios no encontrada.', 404);
    }

    public static function periodo(mixed $desde, mixed $hasta): array
    {
        foreach ([$desde, $hasta] as $value) {
            if (!is_string($value) || !preg_match('/^2026-(0[1-9]|1[0-2])$/', $value)) {
                throw new RuntimeException('Solo se permiten períodos correspondientes al año 2026.', 400);
            }
        }
        if ($desde > $hasta) throw new RuntimeException('El período Hasta no puede ser anterior al período Desde.', 400);
        $months = array_map(static fn(int $month): string => sprintf('2026-%02d', $month), range((int)substr($desde, 5), (int)substr($hasta, 5)));
        return ['periodo_desde' => $desde, 'periodo_hasta' => $hasta, 'cantidad_meses' => count($months), 'meses' => $months];
    }

    private function snapshotKey(): string
    {
        $secret = (string)env('JWT_SECRET', '');
        if ($secret === '') throw new RuntimeException('Falta configuración de firma.', 500);
        return hash_hmac('sha256', 'concurso-promedios-2026', $secret);
    }

    private function diagnostico(): array
    {
        $baseInfo = ['estado' => 'NO DISPONIBLE', 'version' => null, 'periodoDesde' => null,
            'periodoHasta' => null, 'fechaGeneracion' => null, 'vendedores' => null, 'categorias' => null];
        try {
            $base = (new ConcursoBaseOficialStore())->load();
            if ($base !== null) {
                $baseInfo = ['estado' => 'CORRECTA', 'version' => $base['version'],
                    'periodoDesde' => $base['periodoDesde'], 'periodoHasta' => $base['periodoHasta'],
                    'fechaGeneracion' => $base['fechaGeneracion'] ?? null,
                    'vendedores' => count($base['vendedores']), 'categorias' => count($base['categorias'])];
            }
        } catch (RuntimeException $error) {
            $baseInfo['estado'] = 'INVÁLIDA';
            $baseInfo['detalle'] = $error->getMessage();
        }
        $reglasInfo = ['estado' => 'NO DISPONIBLES', 'schemaVersion' => null, 'version' => null,
            'fechaActualizacion' => null];
        try {
            $reglas = ConcursoReglasMeta::load();
            $reglasInfo = ['estado' => 'CORRECTAS', 'schemaVersion' => $reglas['schemaVersion'],
                'version' => $reglas['version'], 'fechaActualizacion' => $reglas['fechaActualizacion']];
        } catch (RuntimeException $error) {
            $reglasInfo['estado'] = str_starts_with($error->getMessage(), 'PARÁMETROS DEL CONCURSO NO DISPONIBLES')
                ? 'NO DISPONIBLES' : 'INVÁLIDAS';
            $reglasInfo['detalle'] = $error->getMessage();
        }
        $months = [['mes' => 9, 'estado' => 'PRUEBA', 'version' => null,
            'fechaCierre' => null, 'cerradoPor' => null]];
        $store = new ConcursoCierreStore();
        foreach ([10, 11, 12] as $month) {
            try {
                $saved = $store->load($month);
                $months[] = ['mes' => $month, 'estado' => $saved['estado'] ?? 'ABIERTO',
                    'version' => $saved['version'] ?? null, 'fechaCierre' => $saved['fechaCierre'] ?? null,
                    'cerradoPor' => $saved['cerradoPor']['nombre'] ?? null];
            } catch (RuntimeException $error) {
                $months[] = ['mes' => $month, 'estado' => 'PENDIENTE', 'version' => null,
                    'fechaCierre' => null, 'cerradoPor' => null, 'detalle' => $error->getMessage()];
            }
        }
        return ['ok' => true, 'anio' => 2026, 'baseOficial' => $baseInfo,
            'reglasMeta' => $reglasInfo, 'meses' => $months];
    }

    private function estado(): array
    {
        $base = (new ConcursoBaseOficialStore())->load();
        if ($base === null) return ['tablaExiste' => false, 'oficial' => false, 'periodo' => null,
            'fechaBloqueo' => null, 'registros' => [], 'fuenteBase' => 'JSON', 'versionBase' => null];
        $period = self::periodo($base['periodoDesde'], $base['periodoHasta']);
        $rows = [];
        foreach ($base['vendedores'] as $vendor) foreach ($vendor['categorias'] as $category => $values) {
            $rows[] = ['usuario_id' => $vendor['usuarioId'], 'codigo_principal' => $vendor['codigoPrincipal'],
                'vendedor_nombre' => $vendor['vendedorNombre'], 'categoria' => $category,
                'promedio_base' => (float)$values['promedioBase'],
                'ventas_mensuales' => array_map('floatval', $values['meses']),
                'periodo_desde' => $base['periodoDesde'], 'periodo_hasta' => $base['periodoHasta'],
                'cantidad_meses' => $base['cantidadMeses']];
        }
        return ['tablaExiste' => true, 'oficial' => count($rows) > 0, 'periodo' => $period,
            'fechaBloqueo' => $base['fechaBloqueo'] ?? $base['fechaGeneracion'], 'registros' => $rows,
            'fuenteBase' => 'JSON', 'versionBase' => $base['version']];
    }

    private function categoria(string $name): ?string
    {
        // Agrupa nombres del catálogo existente; no clasifica productos por su cuenta.
        $key = mb_strtoupper(trim($name));
        return match ($key) {
            'QUIMICOS', 'QUÍMICOS' => 'QUIMICOS',
            'ACCESORIOS', 'PAPEL', 'SACHETS' => 'ACCESORIOS',
            'TAGUAS', 'TRAT_AGUA' => 'TRAT_AGUA',
            'AEROSOL', 'AEROSOLES' => 'AEROSOLES',
            default => null,
        };
    }

    public function calcular(?int $detailUser = null, ?string $detailCategory = null, ?int $detailMonth = null, string $desde = '2026-06', string $hasta = '2026-08'): array
    {
        $period = self::periodo($desde, $hasta);
        $source = $this->analytics->concursoPromediosFuente($detailMonth === null ? $desde : sprintf('2026-%02d', $detailMonth), $detailMonth === null ? $hasta : sprintf('2026-%02d', $detailMonth), $detailUser !== null);
        $vendors = $owners = $sharedOwners = $types = [];
        foreach ($source['relaciones'] as $relation) {
            $id = (int)$relation['usuarioId'];
            $code = mb_strtoupper(trim((string)$relation['codigoAsociado']));
            $vendors[$id] = ['usuario_id' => $id, 'codigo_principal' => trim((string)$relation['codigoPrincipal']), 'vendedor_nombre' => trim((string)$relation['vendedor'])];
            $owners[$code][$id] = true;
            $sharedOwners[$relation['claveCompartida']][$id] = true;
            $types[$id][$code] = strtoupper(trim((string)$relation['tipo']));
        }
        if ($detailUser !== null && !isset($vendors[$detailUser])) throw new RuntimeException('Vendedor no encontrado.', 404);
        $totals = [];
        foreach ($source['ventas'] as $row) $totals[$row['documentoClave']] = ($totals[$row['documentoClave']] ?? 0.0) + (float)$row['original'];
        $adjustments = $percentages = $attribution = [];
        foreach ($source['asignaciones'] as $assignment) {
            $key = $assignment['documentoClave'];
            $percentage = (float)$assignment['porcentaje'];
            if (!is_finite($percentage) || $percentage < 0 || $percentage > 100) throw new RuntimeException('Porcentaje compartido inválido en folio ' . $assignment['folio'], 409);
            $percentages[$key] = ($percentages[$key] ?? 0) + $percentage;
            if ($percentages[$key] > 100.000001) throw new RuntimeException('Las asignaciones superan el 100% del folio ' . $assignment['folio'] . '. Revise la fuente antes de guardar.', 409);
            // Es la distribución por cuentas de sharedCategoryDistribution: los documentos sin total van a Otros.
            foreach ($sharedOwners[$assignment['destinoClave']] ?? [] as $id => $_) $attribution[$key][$id]['recibida'] = true;
            foreach ($sharedOwners[$assignment['origenClave']] ?? [] as $id => $_) $attribution[$key][$id]['origen'] = true;
            if (abs($totals[$key] ?? 0) < 0.000001) continue;
            $amount = (float)$assignment['monto_asignado'];
            foreach ($sharedOwners[$assignment['destinoClave']] ?? [] as $id => $_) {
                $adjustments[$key][$id] = ($adjustments[$key][$id] ?? 0.0) + $amount;
            }
            foreach ($sharedOwners[$assignment['origenClave']] ?? [] as $id => $_) {
                $type = $this->vendorCodeType($assignment['codVendedorOrigen'], $types[$id]);
                $adjustments[$key][$id] = ($adjustments[$key][$id] ?? 0.0) - $this->sharedOutgoingAmount($amount, $type);
            }
        }
        $cents = $documents = [];
        foreach ($source['ventas'] as $row) {
            $categoryName = $source['catalogo'][trim((string)$row['cuentaCategoria'])] ?? '';
            $key = $row['documentoClave'];
            $code = mb_strtoupper(trim((string)$row['codigoVendedor']));
            $selected = ($owners[$code] ?? []) + array_fill_keys(array_keys($adjustments[$key] ?? []), true);
            foreach ($selected as $id => $_) {
                if ($detailUser !== null && $id !== $detailUser) continue;
                $factor = isset($owners[$code][$id]) ? $this->vendorCodeParticipationFactor($this->vendorCodeType($row['codigoVendedor'], $types[$id])) : 0.0;
                if (abs($totals[$key] ?? 0) >= 0.000001) $factor += ($adjustments[$key][$id] ?? 0) / $totals[$key];
                if (abs($factor) < 0.000000001) continue;
                // Regla exclusiva del concurso, aplicada después de determinar la participación.
                $category = isset($attribution[$key][$id]) ? 'TRAT_AGUA' : $this->categoria($categoryName);
                if ($category === null || ($detailCategory !== null && $category !== $detailCategory)) continue;
                $amountCents = (int)round((float)$row['original'] * $factor * 100);
                $month = (int)$row['mes'];
                $cents[$id][$category][$month] = ($cents[$id][$category][$month] ?? 0) + $amountCents;
                if ($detailUser !== null) {
                    $labels = [];
                    if (isset($attribution[$key][$id]['origen'])) $labels[] = 'COMPARTIDA · ORIGEN';
                    if (isset($attribution[$key][$id]['recibida'])) $labels[] = 'COMPARTIDA · RECIBIDA';
                    $accumulated = 0.0;
                    $allocated = 0;
                    foreach ($row['productos'] as $product) {
                        $accumulated += $product['original'] * $factor;
                        $next = (int)round($accumulated * 100);
                        $documents[] = ['tipo' => $row['tipo'], 'folio' => $row['folio'], 'fecha' => $row['fecha'],
                        'cliente' => trim((string)$row['cliente']) ?: $row['clienteCodigo'], 'clienteCodigo' => $row['clienteCodigo'], 'codigoVendedor' => $row['codigoVendedor'],
                        'categoria' => $categoryName, 'categoriaOriginal' => $categoryName, 'categoriaConcurso' => $category,
                        'original' => $product['original'], 'porcentaje' => $factor * 100,
                        'periodo' => sprintf('2026-%02d', $month), 'codigoProducto' => $product['codigoProducto'],
                        'producto' => $product['producto'], 'cantidad' => $product['cantidad'],
                        'tipoAtribucion' => $labels ?: ['DIRECTA'], 'tipoCodigo' => $this->vendorCodeType($row['codigoVendedor'], $types[$id]),
                        'atribuida' => ($next - $allocated) / 100];
                        $allocated = $next;
                    }
                }
            }
        }
        if ($detailUser !== null) return ['documentos' => $documents, 'total' => ($cents[$detailUser][$detailCategory][$detailMonth] ?? 0) / 100];
        $records = [];
        foreach ($vendors as $id => $vendor) {
            foreach (self::CATEGORIAS as $category) {
                $months = $cents[$id][$category] ?? [];
                $monthly = [];
                foreach ($period['meses'] as $month) $monthly[$month] = ($months[(int)substr($month, 5)] ?? 0) / 100;
                $records[] = $vendor + ['categoria' => $category, 'ventas_mensuales' => $monthly,
                    'promedio_base' => round(array_sum($monthly) / $period['cantidad_meses'], 2)];
            }
        }
        return ['registros' => $records, 'vendedores' => count($vendors), 'periodo' => $period];
    }

    private function guardar(int $id, array $body): array
    {
        if (($body['confirmar'] ?? false) !== true) throw new RuntimeException('Debe confirmar el guardado.', 400);
        $snapshot = Security::jwt_decode((string)($body['revision'] ?? ''), $this->snapshotKey());
        if (($snapshot['purpose'] ?? '') !== 'concurso-promedios-2026' || ($snapshot['usuario'] ?? 0) !== $id || empty($snapshot['registros'])) {
            throw new RuntimeException('Calcule y revise los promedios antes de guardar.', 400);
        }
        $categoriesByVendor = [];
        $period = self::periodo($snapshot['periodo']['periodo_desde'] ?? null, $snapshot['periodo']['periodo_hasta'] ?? null);
        $requestedPeriod = self::periodo($body['desde'] ?? null, $body['hasta'] ?? null);
        if ($period !== $requestedPeriod) throw new RuntimeException('El período cambió. Calcule nuevamente antes de guardar.', 400);
        if (!is_array($snapshot['registros'])) throw new RuntimeException('Cálculo preliminar inconsistente.', 400);
        foreach ($snapshot['registros'] as $row) {
            if (!is_array($row) || !is_int($row['usuario_id'] ?? null) || $row['usuario_id'] <= 0
                || !in_array($row['categoria'] ?? null, self::CATEGORIAS, true)
                || !is_string($row['vendedor_nombre'] ?? null) || trim($row['vendedor_nombre']) === ''
                || !is_string($row['codigo_principal'] ?? null)
                || isset($categoriesByVendor[$row['usuario_id']][$row['categoria']])) {
                throw new RuntimeException('Cálculo preliminar inconsistente.', 400);
            }
            if (!is_array($row['ventas_mensuales'] ?? null) || array_keys($row['ventas_mensuales']) !== $period['meses']) {
                throw new RuntimeException('El detalle mensual preliminar está incompleto.', 400);
            }
            foreach (array_merge(array_values($row['ventas_mensuales']), [$row['promedio_base'] ?? null]) as $amount) {
                if (!is_numeric($amount) || !is_finite((float)$amount)) {
                    throw new RuntimeException('Importes preliminares inválidos.', 400);
                }
            }
            if (abs(round(array_sum($row['ventas_mensuales']) / $period['cantidad_meses'], 2) - (float)$row['promedio_base']) > 0.001) throw new RuntimeException('El promedio no coincide con el detalle mensual.', 400);
            $categoriesByVendor[$row['usuario_id']][$row['categoria']] = true;
        }
        foreach ($categoriesByVendor as $categories) {
            if (count($categories) !== count(self::CATEGORIAS)) {
                throw new RuntimeException('Cada vendedor debe tener las cuatro categorías.', 400);
            }
        }
        $replace = ($body['reemplazar'] ?? false) === true;
        $store = new ConcursoBaseOficialStore();
        $current = $store->load();
        if ($current !== null && !$replace) return ['ok' => false, 'code' => 'base_exists',
            'periodo' => self::periodo($current['periodoDesde'], $current['periodoHasta']),
            'error' => 'La base oficial 2026 ya existe. Confirme su reemplazo.'];
        $vendors = [];
        foreach ($snapshot['registros'] as $row) {
            $vendorId = $row['usuario_id'];
            $vendors[$vendorId] ??= ['usuarioId' => $vendorId, 'codigoPrincipal' => $row['codigo_principal'],
                'vendedorNombre' => $row['vendedor_nombre'], 'categorias' => []];
            $monthly = [];
            foreach ($row['ventas_mensuales'] as $month => $amount) $monthly[$month] = number_format((float)$amount, 2, '.', '');
            $vendors[$vendorId]['categorias'][$row['categoria']] = [
                'promedioBase' => number_format((float)$row['promedio_base'], 2, '.', ''), 'meses' => $monthly,
                'fechaCalculo' => $snapshot['fecha'], 'fechaBloqueo' => date('Y-m-d H:i:s')];
        }
        $data = ['schemaVersion' => 1, 'anioConcurso' => 2026, 'version' => 1,
            'periodoDesde' => $period['periodo_desde'], 'periodoHasta' => $period['periodo_hasta'],
            'cantidadMeses' => $period['cantidad_meses'], 'fechaGeneracion' => date('Y-m-d H:i:s'),
            'fechaBloqueo' => date('Y-m-d H:i:s'), 'categorias' => self::CATEGORIAS,
            'vendedores' => array_values($vendors)];
        try {
            $store->save($data, $replace);
        } catch (RuntimeException $e) {
            if ($e->getCode() !== 409 || $replace) throw $e;
            return ['ok' => false, 'code' => 'base_exists', 'periodo' => $this->estado()['periodo'], 'error' => $e->getMessage()];
        }
        return ['ok' => true, 'reemplazada' => $current !== null] + $this->estado();
    }
}
