<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/api/bootstrap.php';

$mes = (int)($argv[1] ?? 10);
$anio = (int)($argv[2] ?? 2026);
$scope = strtolower((string)($argv[3] ?? 'expected'));
$expectedByEmail = [
    'crincones@texpro.cl' => 16,
    'norelbys.oliveros@texpro.cl' => 21,
    'jesparza@texpro.cl' => 20,
];

$db = new Database();
$muestras = new MuestrasService($db);
$analytics = new AnalyticsService($db, $muestras);
$concurso = new ConcursoVentasService($db, $analytics);

function audit_amount_sql(string $typeExpression, string $amountExpression): string
{
    return "CASE
        WHEN $typeExpression = 'N' THEN -ABS(COALESCE($amountExpression, 0))
        WHEN $typeExpression IN ('F', 'D') THEN ABS(COALESCE($amountExpression, 0))
        ELSE 0
    END";
}

function audit_in_clause(array $values, array &$params): string
{
    foreach ($values as $value) {
        $params[] = $value;
    }
    return implode(',', array_fill(0, count($values), '?'));
}

function audit_normalize_area(string $area): string
{
    $text = strtoupper(trim($area));
    $text = preg_replace('/\s+/', '_', $text) ?? $text;
    $text = preg_replace('/[^A-Z0-9_]/', '', $text) ?? $text;
    return trim($text, '_');
}

function audit_call(object $object, string $method, array $args = []): mixed
{
    $ref = new ReflectionMethod($object, $method);
    $ref->setAccessible(true);
    return $ref->invokeArgs($object, $args);
}

function audit_call_static(string $class, string $method, array $args = []): mixed
{
    $ref = new ReflectionMethod($class, $method);
    $ref->setAccessible(true);
    return $ref->invokeArgs(null, $args);
}

function audit_new_clients(PDO $softland, array $vendorCodes, int $anio, int $mes): array
{
    $start = new DateTimeImmutable(sprintf('%04d-%02d-01', $anio, $mes));
    $end = $start->modify('+1 month');
    $params = [];
    $inVendors = audit_in_clause($vendorCodes, $params);
    $amountSql = audit_amount_sql('h.Tipo', 'm.TotLinea');

    $stmt = $softland->prepare(
        "WITH PrimeraCompra AS (
            SELECT LTRIM(RTRIM(h.CodAux)) AS CodAux,
                   MIN(CAST(h.Fecha AS date)) AS FechaPrimeraCompra
            FROM [PRODIN].[softland].[iw_gsaen] h
            WHERE h.Tipo IN ('F','N','D')
              AND h.Estado <> 'A'
              AND h.Fecha < ?
            GROUP BY LTRIM(RTRIM(h.CodAux))
         ),
         PrimeraCompraMonto AS (
            SELECT pc.CodAux,
                   MAX(NULLIF(LTRIM(RTRIM(CONVERT(varchar(max), aux.NomAux))), '')) AS Cliente,
                   pc.FechaPrimeraCompra,
                   SUM($amountSql) AS MontoPrimeraCompra,
                   MIN(LTRIM(RTRIM(h.CodVendedor))) AS VendedorMin,
                   MAX(LTRIM(RTRIM(h.CodVendedor))) AS VendedorMax
            FROM PrimeraCompra pc
            INNER JOIN [PRODIN].[softland].[iw_gsaen] h
               ON LTRIM(RTRIM(h.CodAux)) = pc.CodAux
              AND CAST(h.Fecha AS date) = pc.FechaPrimeraCompra
            INNER JOIN [PRODIN].[softland].[iw_gmovi] m
               ON m.NroInt = h.NroInt
              AND m.Tipo = h.Tipo
            LEFT JOIN [PRODIN].[softland].[cwtauxi] aux
               ON aux.CodAux = h.CodAux
            WHERE h.Tipo IN ('F','N','D')
              AND h.Estado <> 'A'
              AND pc.FechaPrimeraCompra >= ?
              AND pc.FechaPrimeraCompra < ?
              AND EXISTS (
                SELECT 1
                FROM [PRODIN].[softland].[iw_gsaen] hv
                WHERE LTRIM(RTRIM(hv.CodAux)) = pc.CodAux
                  AND CAST(hv.Fecha AS date) = pc.FechaPrimeraCompra
                  AND hv.Tipo IN ('F','N','D')
                  AND hv.Estado <> 'A'
                  AND LTRIM(RTRIM(hv.CodVendedor)) IN ($inVendors)
              )
            GROUP BY pc.CodAux, pc.FechaPrimeraCompra
         )
         SELECT CodAux, Cliente, FechaPrimeraCompra, MontoPrimeraCompra, VendedorMin, VendedorMax
         FROM PrimeraCompraMonto
         WHERE MontoPrimeraCompra > ?
         ORDER BY FechaPrimeraCompra, CodAux"
    );
    $stmt->execute(array_merge(
        [$end->format('Y-m-d'), $start->format('Y-m-d'), $end->format('Y-m-d')],
        $params,
        [200000]
    ));
    return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

function audit_recovered_clients(PDO $softland, array $vendorCodes, int $anio, int $mes, int $diasRecuperacion): array
{
    $start = new DateTimeImmutable(sprintf('%04d-%02d-01', $anio, $mes));
    $end = $start->modify('+1 month');
    $params = [];
    $inVendors = audit_in_clause($vendorCodes, $params);
    $amountSql = audit_amount_sql('h.Tipo', 'm.TotLinea');

    $stmt = $softland->prepare(
        "WITH ComprasActuales AS (
            SELECT
                LTRIM(RTRIM(h.CodAux)) AS CodAux,
                MAX(NULLIF(LTRIM(RTRIM(CONVERT(varchar(max), aux.NomAux))), '')) AS Cliente,
                CAST(h.Fecha AS date) AS FechaRecuperacion,
                SUM($amountSql) AS MontoRecuperacion,
                MIN(LTRIM(RTRIM(h.CodVendedor))) AS VendedorMin,
                MAX(LTRIM(RTRIM(h.CodVendedor))) AS VendedorMax
            FROM [PRODIN].[softland].[iw_gsaen] h
            INNER JOIN [PRODIN].[softland].[iw_gmovi] m
               ON m.NroInt = h.NroInt
              AND m.Tipo = h.Tipo
            LEFT JOIN [PRODIN].[softland].[cwtauxi] aux
               ON aux.CodAux = h.CodAux
            WHERE h.Tipo IN ('F','N','D')
              AND h.Estado <> 'A'
              AND h.Fecha >= ?
              AND h.Fecha < ?
              AND LTRIM(RTRIM(h.CodVendedor)) IN ($inVendors)
            GROUP BY LTRIM(RTRIM(h.CodAux)), CAST(h.Fecha AS date)
         ),
         Recuperaciones AS (
            SELECT
                ca.CodAux,
                ca.Cliente,
                ca.FechaRecuperacion,
                ca.MontoRecuperacion,
                ca.VendedorMin,
                ca.VendedorMax,
                prev.FechaCompraAnterior,
                DATEDIFF(DAY, prev.FechaCompraAnterior, ca.FechaRecuperacion) AS DiasSinComprar,
                ROW_NUMBER() OVER (
                    PARTITION BY ca.CodAux
                    ORDER BY ca.FechaRecuperacion ASC
                ) AS rn
            FROM ComprasActuales ca
            OUTER APPLY (
                SELECT TOP 1 CAST(hPrev.Fecha AS date) AS FechaCompraAnterior
                FROM [PRODIN].[softland].[iw_gsaen] hPrev
                WHERE LTRIM(RTRIM(hPrev.CodAux)) = ca.CodAux
                  AND hPrev.Tipo IN ('F','N','D')
                  AND hPrev.Estado <> 'A'
                  AND hPrev.Fecha < ca.FechaRecuperacion
                ORDER BY hPrev.Fecha DESC, hPrev.NroInt DESC, hPrev.Folio DESC
            ) prev
            WHERE prev.FechaCompraAnterior IS NOT NULL
              AND DATEDIFF(DAY, prev.FechaCompraAnterior, ca.FechaRecuperacion) > ?
              AND ca.MontoRecuperacion > ?
         )
         SELECT CodAux, Cliente, FechaCompraAnterior, FechaRecuperacion, DiasSinComprar, MontoRecuperacion, VendedorMin, VendedorMax
         FROM Recuperaciones
         WHERE rn = 1
         ORDER BY FechaRecuperacion, CodAux"
    );
    $stmt->execute(array_merge(
        [$start->format('Y-m-d'), $end->format('Y-m-d')],
        $params,
        [$diasRecuperacion, 200000]
    ));
    return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

$usersSql =
    "SELECT u.id, u.nombre, u.email, u.area
     FROM usuario u
     WHERE " . ($scope === 'all' ? '' : 'LOWER(u.email) IN (' . implode(',', array_fill(0, count($expectedByEmail), '?')) . ') AND ') . "EXISTS (
        SELECT 1
        FROM usuario_vendedor uv
        WHERE uv.usuario_id = u.id
          AND uv.cod_vendedor IS NOT NULL
          AND TRIM(uv.cod_vendedor) <> ''
     )
     ORDER BY u.nombre";
$users = $db->fetchAll($usersSql, $scope === 'all' ? [] : array_keys($expectedByEmail));

$softland = $db->softland();
$rows = [];

foreach ($users as $user) {
    $userId = (int)$user['id'];
    $relations = $db->fetchAll(
        'SELECT cod_vendedor, tipo FROM usuario_vendedor WHERE usuario_id = ? ORDER BY cod_vendedor',
        [$userId]
    );
    $vendorCodes = array_values(array_unique(array_filter(array_map(
        static fn(array $row): string => trim((string)$row['cod_vendedor']),
        $relations
    ))));
    if (!$vendorCodes) {
        continue;
    }
    $primaryCodes = array_values(array_unique(array_filter(array_map(
        static fn(array $row): string => strtoupper(trim((string)$row['tipo'])) === 'P' ? trim((string)$row['cod_vendedor']) : '',
        $relations
    ))));

    $payload = ['sub' => $userId, 'area' => (string)($user['area'] ?? '')];
    $meta = (float)audit_call($concurso, 'fetchMetaMes', [$userId, $anio, $mes]);
    $ventas = (float)audit_call($concurso, 'ventasAcumuladasPeriodo', [$payload, $mes, $anio]);
    $pct = $meta > 0 ? ($ventas / $meta) * 100 : 0.0;
    $tramo = audit_call_static(ConcursoVentasService::class, 'tramoPorMeta', [$meta]);
    $puntosMeta = ConcursoVentasService::progressPoints($meta, $ventas);
    $area = audit_normalize_area((string)($user['area'] ?? ''));
    $diasRecuperacion = $area === 'TRATAMIENTO_AGUA' ? 365 : 180;
    $areaOk = in_array($area, ['PRODUCTOS_QUIMICOS', 'TRATAMIENTO_AGUA'], true);
    $nuevos = audit_new_clients($softland, $vendorCodes, $anio, $mes);
    $recuperados = audit_recovered_clients($softland, $vendorCodes, $anio, $mes, $diasRecuperacion);
    $nuevosPrimary = $primaryCodes ? audit_new_clients($softland, $primaryCodes, $anio, $mes) : [];
    $recuperadosPrimary = $primaryCodes ? audit_recovered_clients($softland, $primaryCodes, $anio, $mes, $diasRecuperacion) : [];
    $total = $puntosMeta + count($nuevos) * 5 + count($recuperados) * 3;
    $esperado = $expectedByEmail[strtolower((string)$user['email'])] ?? null;

    $rows[] = [
        'vendedor' => $user['nombre'],
        'usuario_id' => $userId,
        'email' => $user['email'],
        'codigos' => implode(',', $vendorCodes),
        'codigos_p' => implode(',', $primaryCodes),
        'area' => $area,
        'area_ok' => $areaOk,
        'meta' => round($meta),
        'venta' => round($ventas),
        'pct' => round($pct, 4),
        'tramo' => $tramo,
        'pts_meta' => $puntosMeta,
        'nuevos' => count($nuevos),
        'pts_nuevos' => count($nuevos) * 5,
        'recuperados' => count($recuperados),
        'pts_recuperados' => count($recuperados) * 3,
        'total' => $total,
        'total_solo_p' => $puntosMeta + count($nuevosPrimary) * 5 + count($recuperadosPrimary) * 3,
        'esperado' => $esperado,
        'diferencia' => $esperado === null ? null : $total - $esperado,
        'detalle_nuevos' => array_map(static fn(array $row): array => [
            'codAux' => trim((string)$row['CodAux']),
            'cliente' => trim((string)($row['Cliente'] ?? '')),
            'fecha' => (string)$row['FechaPrimeraCompra'],
            'monto' => round((float)$row['MontoPrimeraCompra']),
            'vendedorMin' => trim((string)($row['VendedorMin'] ?? '')),
            'vendedorMax' => trim((string)($row['VendedorMax'] ?? '')),
            'puntos' => 5,
        ], $nuevos),
        'detalle_recuperados' => array_map(static fn(array $row): array => [
            'codAux' => trim((string)$row['CodAux']),
            'cliente' => trim((string)($row['Cliente'] ?? '')),
            'fechaAnterior' => (string)$row['FechaCompraAnterior'],
            'fechaRecuperacion' => (string)$row['FechaRecuperacion'],
            'dias' => (int)$row['DiasSinComprar'],
            'monto' => round((float)$row['MontoRecuperacion']),
            'vendedorMin' => trim((string)($row['VendedorMin'] ?? '')),
            'vendedorMax' => trim((string)($row['VendedorMax'] ?? '')),
            'puntos' => 3,
        ], $recuperados),
    ];
}

echo json_encode([
    'periodo' => ['mes' => $mes, 'anio' => $anio],
    'resumen' => array_values(array_filter($rows, static fn(array $row): bool => $row['esperado'] !== null)),
    'todos' => $rows,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), PHP_EOL;
