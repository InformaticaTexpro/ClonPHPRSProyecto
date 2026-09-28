<?php
declare(strict_types=1);

/** Lector y guardado central de parámetros del Concurso de Ventas 2026. */
final class ConcursoReglasMeta
{
    private const FILE = __DIR__ . '/../config/concurso-ventas-2026/parametros.json';
    private static ?array $cached = null;

    public static function load(): array
    {
        if (self::$cached !== null) return self::$cached;
        if (!is_file(self::FILE) || !is_readable(self::FILE)) {
            throw new RuntimeException('PARÁMETROS DEL CONCURSO NO DISPONIBLES: falta parametros.json.', 409);
        }
        $raw = file_get_contents(self::FILE);
        if ($raw === false) throw new RuntimeException('PARÁMETROS DEL CONCURSO NO DISPONIBLES: no se pudo leer el archivo.', 409);
        try {
            $rules = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException $error) {
            throw new RuntimeException('PARÁMETROS DEL CONCURSO INVÁLIDOS: JSON corrupto.', 409, $error);
        }
        self::validate($rules);
        return self::$cached = $rules;
    }

    public static function evaluate(float $meta, float $venta, ?array $rules = null): array
    {
        $rules ??= self::load();
        $types = $rules['ventas']['tiposMeta'];
        $tipo = $meta >= $types['A']['minimoInclusivo'] ? 'A'
            : ($meta >= $types['B']['minimoInclusivo'] ? 'B'
                : ($meta > $types['C']['minimoExclusivo'] ? 'C' : 'SIN META'));
        if ($tipo === 'SIN META') {
            return ['tipo' => $tipo, 'cumplimiento' => 0.0, 'tramo' => 'SIN META', 'puntosMeta' => $types['SIN META']['puntos']];
        }
        $cumplimiento = $venta / $meta * 100;
        foreach ($rules['ventas']['tramosCumplimiento'] as $range) {
            // Comparar importes conserva las fronteras exactas del cálculo anterior.
            $minimum = $range['desde'] === null ? null : $meta * ($range['desde'] / 100);
            $maximum = $range['hasta'] === null ? null : $meta * ($range['hasta'] / 100);
            $above = $minimum === null || (!empty($range['incluyeDesde']) ? $venta >= $minimum : $venta > $minimum);
            $below = $maximum === null || (!empty($range['incluyeHasta']) ? $venta <= $maximum : $venta < $maximum);
            if ($above && $below) {
                return ['tipo' => $tipo, 'cumplimiento' => $cumplimiento, 'tramo' => self::rangeLabel($range, '%'), 'puntosMeta' => $range['puntos'][$tipo]];
            }
        }
        throw new RuntimeException('REGLAS META INVÁLIDAS: ningún tramo cubre el cumplimiento.', 409);
    }

    public static function productPoints(float $superacion, ?array $rules = null): int
    {
        $rules ??= self::load();
        foreach ($rules['productos']['tramosSuperacion'] as $range) {
            $above = $range['desde'] === null || ($range['incluyeDesde'] ? $superacion >= $range['desde'] : $superacion > $range['desde']);
            $below = $range['hasta'] === null || ($range['incluyeHasta'] ? $superacion <= $range['hasta'] : $superacion < $range['hasta']);
            if ($above && $below) return $range['puntos'];
        }
        throw new RuntimeException('PARÁMETROS DEL CONCURSO INVÁLIDOS: ningún tramo cubre Productos.', 409);
    }

    public static function rangeLabel(array $range, string $unit = ''): string
    {
        $from = $range['desde'] === null ? '' : ($range['incluyeDesde'] ? '>=' : '>') . $range['desde'] . $unit;
        $to = $range['hasta'] === null ? '' : ($range['incluyeHasta'] ? '<=' : '<') . $range['hasta'] . $unit;
        return $from && $to ? "$from y $to" : ($from ?: $to);
    }

    public static function saveSection(string $section, array $values, int $expectedVersion, array $actor): array
    {
        if (!in_array($section, ['ventas', 'clientesNuevos', 'clientesRecuperados', 'productos'], true)) {
            throw new RuntimeException('Sección de parámetros inválida.', 400);
        }
        $dir = dirname(self::FILE);
        if (!is_dir($dir) || !is_writable($dir)) throw new RuntimeException('Directorio de parámetros no disponible.', 500);
        $lock = fopen($dir . '/.parametros.lock', 'c');
        if ($lock === false) throw new RuntimeException('No se pudo abrir el bloqueo de parámetros.', 500);
        try {
            if (!flock($lock, LOCK_EX)) throw new RuntimeException('No se pudo bloquear parámetros.', 500);
            self::$cached = null;
            $current = self::load();
            if ($current['version'] !== $expectedVersion) {
                throw new RuntimeException('Los parámetros fueron modificados por otro usuario. Recargue la configuración antes de guardar.', 409);
            }
            $next = $current;
            $next[$section] = $values;
            self::validate($next);
            if ($next[$section] == $current[$section]) return $current;
            $next['version']++;
            $next['fechaActualizacion'] = date('Y-m-d');
            $next['actualizadoPor'] = $actor;
            self::validate($next);
            $json = json_encode($next, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
            $temp = $dir . '/parametros.tmp';
            $stream = fopen($temp, 'wb');
            if ($stream === false) throw new RuntimeException('No se pudo escribir parametros.tmp.', 500);
            try {
                $written = 0;
                while ($written < strlen($json)) {
                    $count = fwrite($stream, substr($json, $written));
                    if ($count === false || $count === 0) throw new RuntimeException('Escritura incompleta de parámetros.', 500);
                    $written += $count;
                }
                if (!fflush($stream)) throw new RuntimeException('No se pudo vaciar parametros.tmp.', 500);
            } finally {
                fclose($stream);
            }
            $check = json_decode((string)file_get_contents($temp), true, 512, JSON_THROW_ON_ERROR);
            self::validate($check);
            if ($check != $next) throw new RuntimeException('parametros.tmp no coincide con el cambio solicitado.', 500);
            $historyDir = $dir . '/historial';
            if (!is_dir($historyDir) && !mkdir($historyDir, 0770, true) && !is_dir($historyDir)) {
                throw new RuntimeException('No se pudo crear el historial de parámetros.', 500);
            }
            $history = $historyDir . '/parametros-v' . $current['version'] . '.json';
            if (is_file($history)) throw new RuntimeException('La versión anterior ya existe en historial.', 409);
            $oldJson = json_encode($current, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
            $historyTemp = $historyDir . '/.parametros-v' . $current['version'] . '.tmp';
            if (file_put_contents($historyTemp, $oldJson, LOCK_EX) !== strlen($oldJson)
                || !rename($historyTemp, $history)) throw new RuntimeException('No se pudo guardar historial de parámetros.', 500);
            if (!rename($temp, self::FILE)) {
                unlink($history);
                throw new RuntimeException('No se pudo reemplazar atómicamente parametros.json.', 500);
            }
            return self::$cached = $next;
        } finally {
            if (isset($temp) && is_file($temp)) unlink($temp);
            if (isset($historyTemp) && is_file($historyTemp)) unlink($historyTemp);
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    public static function validate(mixed $rules): void
    {
        if (!is_array($rules) || !self::keysMatch($rules, ['schemaVersion', 'version', 'anioConcurso', 'fechaActualizacion', 'actualizadoPor', 'ventas', 'clientesNuevos', 'clientesRecuperados', 'productos'])
            || ($rules['schemaVersion'] ?? null) !== 1 || ($rules['anioConcurso'] ?? null) !== 2026
            || !is_int($rules['version'] ?? null) || $rules['version'] < 1
            || !is_string($rules['fechaActualizacion'] ?? null)
            || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $rules['fechaActualizacion'])
            || !array_key_exists('actualizadoPor', $rules)
            || ($rules['actualizadoPor'] !== null && (!is_array($rules['actualizadoPor'])
                || !self::keysMatch($rules['actualizadoPor'], ['usuarioId', 'nombre'])
                || !is_int($rules['actualizadoPor']['usuarioId'] ?? null) || $rules['actualizadoPor']['usuarioId'] <= 0
                || !is_string($rules['actualizadoPor']['nombre'] ?? null)))
            || !is_array($rules['ventas'] ?? null) || !is_array($rules['clientesNuevos'] ?? null)
            || !is_array($rules['clientesRecuperados'] ?? null) || !is_array($rules['productos'] ?? null)) {
            throw new RuntimeException('REGLAS META INVÁLIDAS: estructura general incorrecta.', 409);
        }
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $rules['fechaActualizacion']);
        if (!$date || $date->format('Y-m-d') !== $rules['fechaActualizacion']) {
            throw new RuntimeException('REGLAS META INVÁLIDAS: fecha de actualización incorrecta.', 409);
        }
        $sales = $rules['ventas'];
        if (!self::keysMatch($sales, ['tiposMeta', 'tramosCumplimiento'])
            || !is_array($sales['tiposMeta'] ?? null) || !is_array($sales['tramosCumplimiento'] ?? null)
            || !array_is_list($sales['tramosCumplimiento']) || count($sales['tramosCumplimiento']) !== 7) {
            throw new RuntimeException('PARÁMETROS DEL CONCURSO INVÁLIDOS: ventas incompletas.', 409);
        }
        $types = $sales['tiposMeta'];
        $names = array_keys($types);
        sort($names);
        if ($names !== ['A', 'B', 'C', 'SIN META']
            || !self::keysMatch($types['A'], ['minimoInclusivo'])
            || !self::keysMatch($types['B'], ['minimoInclusivo'])
            || !self::keysMatch($types['C'], ['minimoExclusivo'])
            || !self::keysMatch($types['SIN META'], ['maximoInclusivo', 'puntos'])
            || !self::number($types['A']['minimoInclusivo'] ?? null)
            || !self::number($types['B']['minimoInclusivo'] ?? null)
            || !self::number($types['C']['minimoExclusivo'] ?? null)
            || !self::number($types['SIN META']['maximoInclusivo'] ?? null)
            || ($types['C']['minimoExclusivo'] !== $types['SIN META']['maximoInclusivo'])
            || $types['C']['minimoExclusivo'] != 0
            || $types['B']['minimoInclusivo'] <= 0
            || $types['A']['minimoInclusivo'] <= $types['B']['minimoInclusivo']
            || !is_int($types['SIN META']['puntos'] ?? null) || $types['SIN META']['puntos'] !== 0) {
            throw new RuntimeException('REGLAS META INVÁLIDAS: tipos A/B/C/SIN META solapados o incompletos.', 409);
        }
        $previous = null;
        foreach ($sales['tramosCumplimiento'] as $index => $range) {
            if (!is_array($range) || !self::keysMatch($range,
                    $index === 0 ? ['desde', 'hasta', 'incluyeHasta', 'puntos']
                        : ($index === 6 ? ['desde', 'incluyeDesde', 'hasta', 'puntos']
                            : ['desde', 'incluyeDesde', 'hasta', 'incluyeHasta', 'puntos']))
                || !array_key_exists('desde', $range) || !array_key_exists('hasta', $range)
                || ($range['desde'] !== null && !self::number($range['desde']))
                || ($range['hasta'] !== null && !self::number($range['hasta']))
                || ($range['desde'] !== null && $range['desde'] < 0)
                || ($range['hasta'] !== null && $range['hasta'] < 0)
                || !is_array($range['puntos'] ?? null)) {
                throw new RuntimeException('REGLAS META INVÁLIDAS: tramo incorrecto.', 409);
            }
            $points = $range['puntos'];
            $pointTypes = array_keys($points);
            sort($pointTypes);
            if ($pointTypes !== ['A', 'B', 'C']) throw new RuntimeException('REGLAS META INVÁLIDAS: puntos por tipo incompletos.', 409);
            foreach ($points as $point) if (!is_int($point) || $point < 0) {
                throw new RuntimeException('REGLAS META INVÁLIDAS: puntos negativos o no enteros.', 409);
            }
            if ($index === 0) {
                if ($range['desde'] !== null) throw new RuntimeException('REGLAS META INVÁLIDAS: falta tramo inicial.', 409);
            } else {
                if ($previous['hasta'] === null || $range['desde'] !== $previous['hasta']
                    || !is_bool($range['incluyeDesde'] ?? null)
                    || $range['incluyeDesde'] === $previous['incluyeHasta']) {
                    throw new RuntimeException('REGLAS META INVÁLIDAS: hueco o solapamiento de tramos.', 409);
                }
            }
            if ($range['hasta'] !== null) {
                if (!is_bool($range['incluyeHasta'] ?? null)
                    || ($range['desde'] !== null && $range['hasta'] <= $range['desde'])) {
                    throw new RuntimeException('REGLAS META INVÁLIDAS: límite de tramo incorrecto.', 409);
                }
            } elseif ($index !== count($sales['tramosCumplimiento']) - 1) {
                throw new RuntimeException('REGLAS META INVÁLIDAS: tramo infinito no es el último.', 409);
            }
            $previous = $range;
        }
        if ($previous['hasta'] !== null) throw new RuntimeException('REGLAS META INVÁLIDAS: falta tramo final.', 409);
        foreach (['clientesNuevos', 'clientesRecuperados'] as $section) {
            $client = $rules[$section];
            if (!self::keysMatch($client, $section === 'clientesNuevos' ? ['ventaMinima', 'puntos'] : ['diasMinimosSinCompra', 'ventaMinima', 'puntos'])
                || !self::number($client['ventaMinima'] ?? null) || $client['ventaMinima'] < 0
                || !is_int($client['puntos'] ?? null) || $client['puntos'] < 0) {
                throw new RuntimeException('PARÁMETROS DEL CONCURSO INVÁLIDOS: clientes.', 409);
            }
        }
        if (!is_int($rules['clientesRecuperados']['diasMinimosSinCompra'] ?? null)
            || $rules['clientesRecuperados']['diasMinimosSinCompra'] < 0) {
            throw new RuntimeException('PARÁMETROS DEL CONCURSO INVÁLIDOS: días de recuperación.', 409);
        }
        $productRanges = $rules['productos']['tramosSuperacion'] ?? null;
        if (!self::keysMatch($rules['productos'], ['tramosSuperacion'])
            || !is_array($productRanges) || !array_is_list($productRanges) || count($productRanges) !== 4) {
            throw new RuntimeException('PARÁMETROS DEL CONCURSO INVÁLIDOS: tramos de Productos.', 409);
        }
        $previous = null;
        foreach ($productRanges as $index => $range) {
            if (!is_array($range) || !self::keysMatch($range,
                    $index === 0 ? ['desde', 'hasta', 'incluyeHasta', 'puntos']
                        : ($index === 3 ? ['desde', 'incluyeDesde', 'hasta', 'puntos']
                            : ['desde', 'incluyeDesde', 'hasta', 'incluyeHasta', 'puntos']))
                || !array_key_exists('desde', $range) || !array_key_exists('hasta', $range)
                || ($range['desde'] !== null && !self::number($range['desde']))
                || ($range['hasta'] !== null && !self::number($range['hasta']))
                || ($range['desde'] !== null && $range['desde'] < 0)
                || ($range['hasta'] !== null && $range['hasta'] < 0)
                || !is_int($range['puntos'] ?? null) || $range['puntos'] < 0
                || ($range['desde'] !== null && $range['hasta'] !== null && $range['hasta'] <= $range['desde'])) {
                throw new RuntimeException('PARÁMETROS DEL CONCURSO INVÁLIDOS: tramo de Productos incorrecto.', 409);
            }
            if ($index === 0) {
                if ($range['desde'] !== null || !is_bool($range['incluyeHasta'] ?? null)) {
                    throw new RuntimeException('PARÁMETROS DEL CONCURSO INVÁLIDOS: tramo inicial de Productos.', 409);
                }
            } elseif ($previous['hasta'] === null || $range['desde'] !== $previous['hasta']
                || !is_bool($range['incluyeDesde'] ?? null)
                || $range['incluyeDesde'] === $previous['incluyeHasta']) {
                throw new RuntimeException('PARÁMETROS DEL CONCURSO INVÁLIDOS: hueco o solapamiento en Productos.', 409);
            }
            if ($range['hasta'] !== null && !is_bool($range['incluyeHasta'] ?? null)) {
                throw new RuntimeException('PARÁMETROS DEL CONCURSO INVÁLIDOS: límite de Productos.', 409);
            }
            if ($range['hasta'] === null && $index !== count($productRanges) - 1) {
                throw new RuntimeException('PARÁMETROS DEL CONCURSO INVÁLIDOS: tramo final de Productos.', 409);
            }
            $previous = $range;
        }
        if ($previous['hasta'] !== null) throw new RuntimeException('PARÁMETROS DEL CONCURSO INVÁLIDOS: falta tramo final de Productos.', 409);
    }

    private static function number(mixed $value): bool
    {
        return (is_int($value) || is_float($value)) && is_finite((float)$value);
    }

    private static function keysMatch(mixed $value, array $expected): bool
    {
        if (!is_array($value)) return false;
        $actual = array_keys($value);
        sort($actual);
        sort($expected);
        return $actual === $expected;
    }
}
