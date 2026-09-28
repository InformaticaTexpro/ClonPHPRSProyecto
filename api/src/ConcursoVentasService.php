<?php
declare(strict_types=1);

final class ConcursoVentasService
{
    use SharedServiceHelpers;

    private const CONFIG = [
        'fechaInicio' => '2026-10-01',
        'tramos' => [
            'C' => ['min' => 0, 'max' => 10000000],
            'B' => ['min' => 10000001, 'max' => 25000000],
            'A' => ['min' => 25000001, 'max' => null],
        ],
        'rangosProgreso' => [
            '70_79' => ['min' => 70, 'max' => 80, 'maxInclusive' => false],
            '80_89' => ['min' => 80, 'max' => 90, 'maxInclusive' => false],
            '90_100' => ['min' => 90, 'max' => 100, 'maxInclusive' => true],
            '101_110' => ['min' => 100, 'max' => 110, 'minExclusive' => true, 'maxInclusive' => true],
            '111_120' => ['min' => 110, 'max' => 120, 'minExclusive' => true, 'maxInclusive' => true],
            '121_mas' => ['min' => 120, 'max' => null, 'minExclusive' => true],
        ],
        'puntosPorTramo' => [
            'A' => ['70_79' => 10, '80_89' => 13, '90_100' => 14, '101_110' => 17, '111_120' => 20, '121_mas' => 23],
            'B' => ['70_79' => 5, '80_89' => 7, '90_100' => 9, '101_110' => 12, '111_120' => 15, '121_mas' => 18],
            'C' => ['70_79' => 2, '80_89' => 4, '90_100' => 6, '101_110' => 9, '111_120' => 12, '121_mas' => 15],
        ],
        'montoMinimoNuevo' => 200000,
        'puntosNuevo' => 5,
        'montoMinimoRecuperado' => 200000,
        'puntosRecuperado' => 3,
        'diasRecuperacionPorArea' => [
            'PRODUCTOS_QUIMICOS' => 180,
            'TRATAMIENTO_AGUA' => 365,
        ],
    ];

    public function __construct(private Database $db, private AnalyticsService $analytics)
    {
    }

    public function puntaje(array $payload, array $query): array
    {
        $userId = $this->currentUserIdFromPayload($payload);
        $periodo = $this->monthYear($query);
        $mes = $periodo['mes'];
        $anio = $periodo['anio'];

        $modoValidacion = self::isValidationPeriod($anio, $mes);
        $activoOficial = self::isActiveForPeriod($anio, $mes);
        if (!self::isVisibleForPeriod($anio, $mes)) {
            return ['ok' => true, 'activo' => false, 'visible' => false, 'modoValidacion' => false, 'puntos' => 0];
        }

        $snapshot = $activoOficial ? $this->snapshotMensual($userId, $anio, $mes) : null;
        if ($snapshot !== null) {
            return [
                'ok' => true,
                'activo' => true,
                'visible' => true,
                'modoValidacion' => false,
                'puntos' => (int)$snapshot['puntosTotal'],
                'fuente' => 'snapshot',
                'snapshot' => $snapshot,
            ];
        }

        if ($unavailable = $this->softlandUnavailable('el puntaje de concurso')) {
            return $unavailable;
        }

        $resultado = $this->calcularPuntajeMensual($payload, $anio, $mes);
        return [
            'ok' => true,
            'activo' => $activoOficial,
            'visible' => true,
            'modoValidacion' => $modoValidacion,
            'puntos' => (int)$resultado['puntosTotal'],
            'fuente' => 'dinamico',
            'resultado' => $resultado,
        ];
    }

    public function calcularPuntajeMensual(array $payload, int $anio, int $mes): array
    {
        $userId = $this->currentUserIdFromPayload($payload);
        $vendorCodes = $this->normalizeVendorCodes($this->getVendorCodes($userId));
        if (!$vendorCodes) {
            return $this->buildScoreResult($userId, $anio, $mes, 0.0, 0.0, 0, 0, 0);
        }

        $meta = $this->fetchMetaMes($userId, $anio, $mes);
        $ventas = $this->ventasAcumuladasPeriodo($payload, $mes, $anio);
        $area = $this->userArea($payload, $userId);
        $diasRecuperacion = $this->diasRecuperacionPorArea($area);

        $clientesNuevos = $this->clientesNuevosPuntuables($vendorCodes, $anio, $mes);
        $clientesRecuperados = $this->clientesRecuperadosPuntuables($vendorCodes, $anio, $mes, $diasRecuperacion);

        return $this->buildScoreResult(
            $userId,
            $anio,
            $mes,
            $meta,
            $ventas,
            self::progressPoints($meta, $ventas),
            $clientesNuevos,
            $clientesRecuperados
        );
    }

    public function guardarSnapshotMensual(array $payload, int $anio, int $mes, ?string $observacion = null, bool $dryRun = false): array
    {
        if (!self::isActiveForPeriod($anio, $mes) && !$dryRun) {
            $nota = mb_strtolower((string)$observacion);
            $esPruebaExplicita = self::isValidationPeriod($anio, $mes)
                && (str_contains($nota, 'prueba') || str_contains($nota, 'validacion') || str_contains($nota, 'simulacion'));
            if (!$esPruebaExplicita) {
                throw new RuntimeException('No se puede guardar cierre oficial antes del inicio del concurso.', 400);
            }
        }

        $resultado = $this->calcularPuntajeMensual($payload, $anio, $mes);
        self::assertSnapshotConsistent($resultado);

        $snapshot = [
            'usuario_id' => (int)$resultado['usuarioId'],
            'anio' => $anio,
            'mes' => $mes,
            'fecha_cierre' => (new DateTimeImmutable($this->monthStart($anio, $mes)))->modify('last day of this month')->format('Y-m-d'),
            'porcentaje_meta' => round((float)$resultado['porcentajeMeta'], 2),
            'puntos_meta' => (int)$resultado['puntosMeta'],
            'clientes_nuevos' => (int)$resultado['clientesNuevos'],
            'puntos_nuevos' => (int)$resultado['puntosNuevos'],
            'clientes_recuperados' => (int)$resultado['clientesRecuperados'],
            'puntos_recuperados' => (int)$resultado['puntosRecuperados'],
            'puntos_total' => (int)$resultado['puntosTotal'],
            'observacion' => $observacion,
        ];

        if ($dryRun) {
            return ['ok' => true, 'dryRun' => true, 'snapshot' => $snapshot];
        }

        $this->db->execute(self::snapshotUpsertSql(), [
            $snapshot['usuario_id'],
            $snapshot['anio'],
            $snapshot['mes'],
            $snapshot['fecha_cierre'],
            $snapshot['porcentaje_meta'],
            $snapshot['puntos_meta'],
            $snapshot['clientes_nuevos'],
            $snapshot['puntos_nuevos'],
            $snapshot['clientes_recuperados'],
            $snapshot['puntos_recuperados'],
            $snapshot['puntos_total'],
            $snapshot['observacion'],
        ]);

        return ['ok' => true, 'dryRun' => false, 'snapshot' => $this->snapshotMensual((int)$resultado['usuarioId'], $anio, $mes)];
    }

    public static function assertSnapshotConsistent(array $resultado): void
    {
        $clientesNuevos = (int)($resultado['clientesNuevos'] ?? 0);
        $puntosNuevos = (int)($resultado['puntosNuevos'] ?? 0);
        $clientesRecuperados = (int)($resultado['clientesRecuperados'] ?? 0);
        $puntosRecuperados = (int)($resultado['puntosRecuperados'] ?? 0);
        $puntosMeta = (int)($resultado['puntosMeta'] ?? 0);
        $puntosTotal = (int)($resultado['puntosTotal'] ?? 0);

        if ($puntosNuevos !== $clientesNuevos * (int)self::CONFIG['puntosNuevo']) {
            throw new RuntimeException('Inconsistencia en puntos de clientes nuevos.', 500);
        }
        if ($puntosRecuperados !== $clientesRecuperados * (int)self::CONFIG['puntosRecuperado']) {
            throw new RuntimeException('Inconsistencia en puntos de clientes recuperados.', 500);
        }
        if ($puntosTotal !== $puntosMeta + $puntosNuevos + $puntosRecuperados) {
            throw new RuntimeException('Inconsistencia en puntos totales del concurso.', 500);
        }
    }

    public static function snapshotUpsertSql(string $table = 'concurso_puntaje_mensual'): string
    {
        return "INSERT INTO {$table} (
                usuario_id, anio, mes, fecha_cierre, porcentaje_meta,
                puntos_meta, clientes_nuevos, puntos_nuevos,
                clientes_recuperados, puntos_recuperados, puntos_total, observacion
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                fecha_cierre = VALUES(fecha_cierre),
                porcentaje_meta = VALUES(porcentaje_meta),
                puntos_meta = VALUES(puntos_meta),
                clientes_nuevos = VALUES(clientes_nuevos),
                puntos_nuevos = VALUES(puntos_nuevos),
                clientes_recuperados = VALUES(clientes_recuperados),
                puntos_recuperados = VALUES(puntos_recuperados),
                puntos_total = VALUES(puntos_total),
                observacion = VALUES(observacion),
                updated_at = CURRENT_TIMESTAMP";
    }

    public static function isActiveForPeriod(int $anio, int $mes): bool
    {
        $periodStart = new DateTimeImmutable(sprintf('%04d-%02d-01', $anio, $mes));
        $contestStart = new DateTimeImmutable((string)self::CONFIG['fechaInicio']);
        return $periodStart >= $contestStart;
    }

    public static function isValidationPeriod(int $anio, int $mes): bool
    {
        return $anio === 2026 && $mes === 9;
    }

    public static function isVisibleForPeriod(int $anio, int $mes): bool
    {
        return self::isValidationPeriod($anio, $mes) || self::isActiveForPeriod($anio, $mes);
    }

    public static function progressPoints(float $meta, float $ventas): int
    {
        if ($meta <= 0) {
            return 0;
        }

        $tramo = self::tramoPorMeta($meta);
        $rango = self::rangoProgreso(round(($ventas / $meta) * 100, 8));
        if ($tramo === null || $rango === null) {
            return 0;
        }

        return (int)(self::CONFIG['puntosPorTramo'][$tramo][$rango] ?? 0);
    }

    public static function countEligibleGroupedPurchases(array $rows, float $minimumAmount): int
    {
        $groups = [];
        foreach ($rows as $row) {
            $codAux = trim((string)($row['CodAux'] ?? $row['codAux'] ?? ''));
            $fecha = substr(trim((string)($row['FechaCompra'] ?? $row['fechaCompra'] ?? '')), 0, 10);
            if ($codAux === '' || $fecha === '') {
                continue;
            }
            $key = mb_strtoupper($codAux) . '|' . $fecha;
            $groups[$key] = ($groups[$key] ?? 0.0) + (float)($row['Monto'] ?? $row['monto'] ?? 0);
        }

        $total = 0;
        foreach ($groups as $amount) {
            if ($amount > $minimumAmount) {
                $total++;
            }
        }
        return $total;
    }

    public static function isRecoveredByDays(?string $previousDate, string $recoveryDate, int $daysThreshold): bool
    {
        if ($previousDate === null || trim($previousDate) === '') {
            return false;
        }

        $previous = new DateTimeImmutable(substr($previousDate, 0, 10));
        $recovery = new DateTimeImmutable(substr($recoveryDate, 0, 10));
        return (int)$previous->diff($recovery)->days > $daysThreshold;
    }

    private static function tramoPorMeta(float $meta): ?string
    {
        foreach (self::CONFIG['tramos'] as $tramo => $limits) {
            $min = (float)$limits['min'];
            $max = $limits['max'] === null ? null : (float)$limits['max'];
            if ($meta >= $min && ($max === null || $meta <= $max)) {
                return (string)$tramo;
            }
        }
        return null;
    }

    private static function rangoProgreso(float $percentage): ?string
    {
        foreach (self::CONFIG['rangosProgreso'] as $key => $range) {
            $min = (float)$range['min'];
            $max = $range['max'] === null ? null : (float)$range['max'];
            $minOk = !empty($range['minExclusive']) ? $percentage > $min : $percentage >= $min;
            $maxOk = $max === null
                ? true
                : (!empty($range['maxInclusive']) ? $percentage <= $max : $percentage < $max);
            if ($minOk && $maxOk) {
                return (string)$key;
            }
        }
        return null;
    }

    private function fetchMetaMes(int $userId, int $anio, int $mes): float
    {
        $fechaMes = $this->monthStart($anio, $mes);
        $row = $this->db->fetchOne(
            "SELECT vm.meta
             FROM vendedor_meta vm
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

        return (float)($row['meta'] ?? 0);
    }

    private function snapshotMensual(int $userId, int $anio, int $mes): ?array
    {
        $row = $this->db->fetchOne(
            "SELECT usuario_id, anio, mes, fecha_cierre, porcentaje_meta,
                    puntos_meta, clientes_nuevos, puntos_nuevos,
                    clientes_recuperados, puntos_recuperados, puntos_total,
                    observacion, created_at, updated_at
             FROM concurso_puntaje_mensual
             WHERE usuario_id = ?
               AND anio = ?
               AND mes = ?
             LIMIT 1",
            [$userId, $anio, $mes]
        );

        if (!$row) {
            return null;
        }

        return [
            'usuarioId' => (int)$row['usuario_id'],
            'anio' => (int)$row['anio'],
            'mes' => (int)$row['mes'],
            'fechaCierre' => (string)$row['fecha_cierre'],
            'porcentajeMeta' => (float)$row['porcentaje_meta'],
            'puntosMeta' => (int)$row['puntos_meta'],
            'clientesNuevos' => (int)$row['clientes_nuevos'],
            'puntosNuevos' => (int)$row['puntos_nuevos'],
            'clientesRecuperados' => (int)$row['clientes_recuperados'],
            'puntosRecuperados' => (int)$row['puntos_recuperados'],
            'puntosTotal' => (int)$row['puntos_total'],
            'observacion' => $row['observacion'],
            'createdAt' => (string)$row['created_at'],
            'updatedAt' => (string)$row['updated_at'],
        ];
    }

    private function buildScoreResult(
        int $userId,
        int $anio,
        int $mes,
        float $meta,
        float $ventas,
        int $puntosMeta,
        int $clientesNuevos,
        int $clientesRecuperados
    ): array {
        $puntosNuevos = $clientesNuevos * (int)self::CONFIG['puntosNuevo'];
        $puntosRecuperados = $clientesRecuperados * (int)self::CONFIG['puntosRecuperado'];
        $resultado = [
            'usuarioId' => $userId,
            'anio' => $anio,
            'mes' => $mes,
            'meta' => $meta,
            'venta' => $ventas,
            'porcentajeMeta' => $meta > 0 ? round(($ventas / $meta) * 100, 8) : 0.0,
            'puntosMeta' => $puntosMeta,
            'clientesNuevos' => $clientesNuevos,
            'puntosNuevos' => $puntosNuevos,
            'clientesRecuperados' => $clientesRecuperados,
            'puntosRecuperados' => $puntosRecuperados,
            'puntosTotal' => $puntosMeta + $puntosNuevos + $puntosRecuperados,
        ];

        self::assertSnapshotConsistent($resultado);
        return $resultado;
    }

    private function ventasAcumuladasPeriodo(array $payload, int $mes, int $anio): float
    {
        $resumen = $this->analytics->resumen($payload, ['mes' => $mes, 'anio' => $anio]);
        if (($resumen['ok'] ?? false) !== true) {
            return 0.0;
        }
        return (float)($resumen['totalVentas'] ?? 0);
    }

    private function clientesNuevosPuntuables(array $vendorCodes, int $anio, int $mes): int
    {
        $start = new DateTimeImmutable($this->monthStart($anio, $mes));
        $end = $start->modify('+1 month');
        $params = [];
        $inVendors = $this->inClause($vendorCodes, $params);
        $amountSql = $this->commercialAmountSql('h.Tipo', 'm.TotLinea');

        $stmt = $this->softland()->prepare(
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
                       pc.FechaPrimeraCompra,
                       SUM($amountSql) AS MontoPrimeraCompra
                FROM PrimeraCompra pc
                INNER JOIN [PRODIN].[softland].[iw_gsaen] h
                   ON LTRIM(RTRIM(h.CodAux)) = pc.CodAux
                  AND CAST(h.Fecha AS date) = pc.FechaPrimeraCompra
                INNER JOIN [PRODIN].[softland].[iw_gmovi] m
                   ON m.NroInt = h.NroInt
                  AND m.Tipo = h.Tipo
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
             SELECT COUNT(*) AS cantidad
             FROM PrimeraCompraMonto
             WHERE MontoPrimeraCompra > ?"
        );
        $stmt->execute(array_merge(
            [$end->format('Y-m-d'), $start->format('Y-m-d'), $end->format('Y-m-d')],
            $params,
            [self::CONFIG['montoMinimoNuevo']]
        ));
        $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
        return (int)($row['cantidad'] ?? 0);
    }

    private function clientesRecuperadosPuntuables(array $vendorCodes, int $anio, int $mes, int $diasRecuperacion): int
    {
        $start = new DateTimeImmutable($this->monthStart($anio, $mes));
        $end = $start->modify('+1 month');
        $params = [];
        $inVendors = $this->inClause($vendorCodes, $params);
        $amountSql = $this->commercialAmountSql('h.Tipo', 'm.TotLinea');

        $stmt = $this->softland()->prepare(
            "WITH ComprasActuales AS (
                SELECT
                    LTRIM(RTRIM(h.CodAux)) AS CodAux,
                    CAST(h.Fecha AS date) AS FechaRecuperacion,
                    SUM($amountSql) AS MontoRecuperacion
                FROM [PRODIN].[softland].[iw_gsaen] h
                INNER JOIN [PRODIN].[softland].[iw_gmovi] m
                   ON m.NroInt = h.NroInt
                  AND m.Tipo = h.Tipo
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
                    ca.FechaRecuperacion,
                    ca.MontoRecuperacion,
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
             SELECT COUNT(*) AS cantidad
             FROM Recuperaciones
             WHERE rn = 1"
        );
        $stmt->execute(array_merge(
            [$start->format('Y-m-d'), $end->format('Y-m-d')],
            $params,
            [$diasRecuperacion, self::CONFIG['montoMinimoRecuperado']]
        ));
        $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
        return (int)($row['cantidad'] ?? 0);
    }

    private function userArea(array $payload, int $userId): string
    {
        $area = trim((string)($payload['area'] ?? ''));
        if ($area !== '') {
            return $area;
        }

        $row = $this->db->fetchOne('SELECT area FROM usuario WHERE id = ? LIMIT 1', [$userId]);
        return trim((string)($row['area'] ?? ''));
    }

    private function diasRecuperacionPorArea(string $area): int
    {
        $normalized = $this->normalizeAreaCode($area);
        return (int)(self::CONFIG['diasRecuperacionPorArea'][$normalized] ?? self::CONFIG['diasRecuperacionPorArea']['PRODUCTOS_QUIMICOS']);
    }

    private function normalizeAreaCode(string $area): string
    {
        $text = strtoupper(trim($area));
        $text = preg_replace('/\s+/', '_', $text) ?? $text;
        $text = preg_replace('/[^A-Z0-9_]/', '', $text) ?? $text;
        return trim($text, '_');
    }
}
