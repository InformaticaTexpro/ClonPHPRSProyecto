<?php
declare(strict_types=1);
require_once __DIR__ . '/ConcursoReglasMeta.php';

final class ConcursoVentasService
{
    use SharedServiceHelpers;

    private const CONFIG = [
        'fechaInicio' => '2026-10-01',
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

        if (!self::isActiveForPeriod($anio, $mes)) {
            return ['ok' => true, 'activo' => false, 'puntos' => 0];
        }

        if ($unavailable = $this->softlandUnavailable('el puntaje de concurso')) {
            return $unavailable;
        }

        $vendorCodes = $this->normalizeVendorCodes($this->getVendorCodes($userId));
        if (!$vendorCodes) {
            return ['ok' => true, 'activo' => true, 'puntos' => 0];
        }

        $meta = $this->fetchMetaMes($userId, $anio, $mes);
        $ventas = $this->ventasAcumuladasPeriodo($payload, $mes, $anio);
        $area = $this->userArea($payload, $userId);
        $diasRecuperacion = $this->diasRecuperacionPorArea($area);

        $puntos = self::progressPoints($meta, $ventas)
            + ($this->clientesNuevosPuntuables($vendorCodes, $anio, $mes) * (int)self::CONFIG['puntosNuevo'])
            + ($this->clientesRecuperadosPuntuables($vendorCodes, $anio, $mes, $diasRecuperacion) * (int)self::CONFIG['puntosRecuperado']);

        return ['ok' => true, 'activo' => true, 'puntos' => $puntos];
    }

    public static function isActiveForPeriod(int $anio, int $mes): bool
    {
        $periodStart = new DateTimeImmutable(sprintf('%04d-%02d-01', $anio, $mes));
        $contestStart = new DateTimeImmutable((string)self::CONFIG['fechaInicio']);
        return $periodStart >= $contestStart;
    }

    public static function progressPoints(float $meta, float $ventas): int
    {
        return ConcursoReglasMeta::evaluate($meta, $ventas)['puntosMeta'];
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
            "WITH ClientesAsignados AS (
                SELECT DISTINCT LTRIM(RTRIM(CodAux)) AS CodAux
                FROM [PRODIN].[softland].[cwtauxven]
                WHERE LTRIM(RTRIM(VenCod)) IN ($inVendors)
             ),
             PrimeraCompra AS (
                SELECT LTRIM(RTRIM(h.CodAux)) AS CodAux,
                       MIN(CAST(h.Fecha AS date)) AS FechaPrimeraCompra
                FROM [PRODIN].[softland].[iw_gsaen] h
                INNER JOIN ClientesAsignados ca ON ca.CodAux = LTRIM(RTRIM(h.CodAux))
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
                GROUP BY pc.CodAux, pc.FechaPrimeraCompra
             )
             SELECT COUNT(*) AS cantidad
             FROM PrimeraCompraMonto
             WHERE MontoPrimeraCompra > ?"
        );
        $stmt->execute(array_merge(
            $params,
            [$end->format('Y-m-d'), $start->format('Y-m-d'), $end->format('Y-m-d'), self::CONFIG['montoMinimoNuevo']]
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
