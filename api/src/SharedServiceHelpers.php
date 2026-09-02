<?php
declare(strict_types=1);

trait SharedServiceHelpers
{
    private array $vendorRelationsByUserId = [];

    protected function currentUserIdFromPayload(array $payload): int
    {
        $userId = (int)($payload['sub'] ?? $payload['id'] ?? 0);
        if ($userId <= 0) {
            throw new RuntimeException('Token inválido.', 401);
        }
        return $userId;
    }

    protected function currentUserId(array $payload): int
    {
        return $this->currentUserIdFromPayload($payload);
    }

    protected function userId(array $payload): int
    {
        return $this->currentUserIdFromPayload($payload);
    }

    protected function vendorCodesFromUserId(int $userId): array
    {
        $rows = $this->vendorRelationsFromUserId($userId);
        $codes = array_values(array_unique(array_filter(array_map(
            static fn(array $row): string => trim((string)($row['cod_vendedor'] ?? '')),
            $rows
        ))));

        if ($codes) {
            return $codes;
        }

        $user = $this->db->fetchOne('SELECT is_admin FROM usuario WHERE id = ? LIMIT 1', [$userId]);
        if (!(bool)($user['is_admin'] ?? false)) {
            return [];
        }

        $fallbackRows = $this->db->fetchAll(
            "SELECT DISTINCT TRIM(cod_vendedor) AS cod_vendedor
             FROM usuario_vendedor
             WHERE cod_vendedor IS NOT NULL
               AND TRIM(cod_vendedor) <> ''"
        );

        return array_values(array_unique(array_filter(array_map(
            static fn(array $row): string => trim((string)($row['cod_vendedor'] ?? '')),
            $fallbackRows
        ))));
    }

    protected function coordinatorCodesFromUserId(int $userId): array
    {
        $rows = $this->vendorRelationsFromUserId($userId);
        return array_values(array_filter(array_map(static function (array $row): string {
            $tipo = strtoupper(trim((string)($row['tipo'] ?? '')));
            return $tipo === 'C' ? trim((string)($row['cod_vendedor'] ?? '')) : '';
        }, $rows)));
    }

    protected function getVendorCodes(int $userId): array
    {
        return $this->vendorCodesFromUserId($userId);
    }

    protected function getCoordinatorCodes(int $userId): array
    {
        return $this->coordinatorCodesFromUserId($userId);
    }

    protected function vendorRelationsFromUserId(int $userId): array
    {
        if (!array_key_exists($userId, $this->vendorRelationsByUserId)) {
            $this->vendorRelationsByUserId[$userId] = $this->db->fetchAll(
                'SELECT cod_vendedor, tipo FROM usuario_vendedor WHERE usuario_id = ?',
                [$userId]
            );
        }

        return $this->vendorRelationsByUserId[$userId];
    }

    protected function vendorCodeTypeMap(array $relations): array
    {
        $map = [];
        foreach ($relations as $relation) {
            $code = trim((string)($relation['codigoAsociado'] ?? $relation['cod_vendedor'] ?? ''));
            if ($code === '') {
                continue;
            }

            $type = strtoupper(trim((string)($relation['tipo'] ?? '')));
            foreach ($this->normalizeVendorCodes([$code]) as $normalizedCode) {
                $map[mb_strtoupper((string)$normalizedCode)] = $type;
            }
        }

        return $map;
    }

    protected function vendorCodeTypeMapFromUserId(int $userId): array
    {
        return $this->vendorCodeTypeMap($this->vendorRelationsFromUserId($userId));
    }

    protected function vendorCodeType(mixed $code, array $typeMap): string
    {
        foreach ($this->normalizeVendorCodes([(string)$code]) as $normalizedCode) {
            $key = mb_strtoupper((string)$normalizedCode);
            if (array_key_exists($key, $typeMap)) {
                return strtoupper(trim((string)$typeMap[$key]));
            }
        }

        return '';
    }

    protected function vendorCodeParticipationFactor(mixed $type): float
    {
        return strtoupper(trim((string)$type)) === 'C' ? 0.5 : 1.0;
    }

    protected function sharedOutgoingAmount(mixed $amount, mixed $vendorCodeType): float
    {
        return $this->vendorCodeParticipationFactor($vendorCodeType) < 1.0 ? 0.0 : (float)$amount;
    }

    protected function vendorCodes(array $payload): array
    {
        return $this->vendorCodesFromUserId($this->currentUserIdFromPayload($payload));
    }

    protected function coordinatorCodes(array $payload): array
    {
        return $this->coordinatorCodesFromUserId($this->currentUserIdFromPayload($payload));
    }

    protected function monthYear(array $query): array
    {
        return Security::validate_mes_anio($query['mes'] ?? null, $query['anio'] ?? null);
    }

    protected function monthStart(int $anio, int $mes): string
    {
        return sprintf('%04d-%02d-01', $anio, $mes);
    }

    protected function monthEnd(int $anio, int $mes): string
    {
        return (new DateTimeImmutable($this->monthStart($anio, $mes)))->modify('last day of this month')->format('Y-m-d');
    }

    protected function softland(): PDO
    {
        return $this->db->softland();
    }

    protected function asSoftlandPool(): PDO
    {
        return $this->softland();
    }

    protected function softlandUnavailable(string $scope): ?array
    {
        if ($this->db->softlandAvailable()) {
            return null;
        }

        return [
            'ok' => false,
            'error' => sprintf(
                'No se pueden cargar los datos de %s porque falta el driver PDO_SQLSRV en este servidor.',
                $scope
            ),
        ];
    }

    protected function buildInClause(array $values, array &$params): string
    {
        $placeholders = [];
        foreach ($values as $value) {
            $placeholders[] = '?';
            $params[] = $value;
        }
        return implode(',', $placeholders);
    }

    protected function inClause(array $values, array &$params): string
    {
        return $this->buildInClause($values, $params);
    }

    protected function normalizeVendorCodes(array $codes): array
    {
        $normalized = [];

        foreach ($codes as $raw) {
            $code = trim((string)$raw);
            if ($code === '') {
                continue;
            }

            $normalized[$code] = true;

            if (preg_match('/^\d+$/', $code)) {
                $unpad = ltrim($code, '0');
                if ($unpad === '') {
                    $unpad = '0';
                }

                $normalized[$unpad] = true;
                $normalized[str_pad($unpad, 2, '0', STR_PAD_LEFT)] = true;
                $normalized[str_pad($unpad, 4, '0', STR_PAD_LEFT)] = true;
            }
        }

        return array_map('strval', array_keys($normalized));
    }

    protected function commercialAmountSql(string $typeExpression, string $amountExpression): string
    {
        return "CASE
            WHEN $typeExpression = 'N' THEN -ABS(COALESCE($amountExpression, 0))
            WHEN $typeExpression IN ('F', 'D') THEN ABS(COALESCE($amountExpression, 0))
            ELSE 0
        END";
    }

    protected function commercialAmount(mixed $amount, mixed $type): float
    {
        $value = abs((float)$amount);
        return strtoupper(trim((string)$type)) === 'N' ? -$value : $value;
    }
}
