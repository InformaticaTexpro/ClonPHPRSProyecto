<?php
declare(strict_types=1);

/** Archivo privado único por mes; el bloqueo cubre también las comprobaciones de orden. */
final class ConcursoCierreStore
{
    private const DEFAULT_DIR = __DIR__ . '/../storage/concurso-ventas-2026/cierres';
    private const CATEGORIES = ['QUIMICOS', 'ACCESORIOS', 'TRAT_AGUA', 'AEROSOLES'];

    private static function directory(): string
    {
        $configured = trim((string)env('CONCURSO_CIERRES_DIR', ''));
        return $configured !== '' ? $configured : self::DEFAULT_DIR;
    }

    public static function period(int $month): string
    {
        if ($month < 10 || $month > 12) {
            throw new RuntimeException($month === 9
                ? 'Septiembre 2026 corresponde al período de prueba y no puede cerrarse.'
                : 'Solo pueden cerrarse Octubre, Noviembre y Diciembre de 2026.', 400);
        }
        return sprintf('2026-%02d', $month);
    }

    public function load(int $month): ?array
    {
        $file = self::directory() . '/' . self::period($month) . '.json';
        if (!is_file($file)) return null;
        $raw = file_get_contents($file);
        if ($raw === false) throw new RuntimeException('SNAPSHOT OFICIAL NO DISPONIBLE.', 409);
        try {
            $data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
            $this->validate($data, $month);
        } catch (JsonException | RuntimeException $error) {
            throw new RuntimeException('SNAPSHOT OFICIAL INVÁLIDO: ' . $error->getMessage(), 409, $error);
        }
        return $data;
    }

    public function locked(callable $operation): mixed
    {
        $dir = self::directory();
        if (!is_dir($dir) && !mkdir($dir, 0770, true) && !is_dir($dir)) {
            throw new RuntimeException('No se pudo crear el directorio privado de cierres.', 500);
        }
        if (!is_readable($dir) || !is_writable($dir)) throw new RuntimeException('El directorio de cierres no tiene permisos de lectura/escritura.', 500);
        $lock = fopen($dir . '/.cierres.lock', 'c');
        if ($lock === false) throw new RuntimeException('No se pudo abrir el bloqueo de cierres.', 500);
        try {
            if (!flock($lock, LOCK_EX)) throw new RuntimeException('No se pudo bloquear el cierre.', 500);
            return $operation();
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    /** Llamar bajo locked(): temporal en el mismo volumen y reemplazo atómico. */
    public function save(array $data, int $month): array
    {
        $this->validate($data, $month);
        $dir = self::directory();
        $file = $dir . '/' . self::period($month) . '.json';
        $temp = tempnam($dir, '.cierre-');
        if ($temp === false) throw new RuntimeException('No se pudo crear el temporal del cierre.', 500);
        try {
            $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
            $stream = fopen($temp, 'wb');
            if ($stream === false) throw new RuntimeException('No se pudo escribir el temporal del cierre.', 500);
            try {
                $written = 0;
                while ($written < strlen($json)) {
                    $count = fwrite($stream, substr($json, $written));
                    if ($count === false || $count === 0) throw new RuntimeException('Escritura incompleta del cierre.', 500);
                    $written += $count;
                }
                if (!fflush($stream)) throw new RuntimeException('No se pudo vaciar el temporal del cierre.', 500);
            } finally {
                fclose($stream);
            }
            $decoded = json_decode((string)file_get_contents($temp), true, 512, JSON_THROW_ON_ERROR);
            $this->validate($decoded, $month);
            if ($decoded !== $data) throw new RuntimeException('El temporal del cierre no coincide con el cálculo.', 500);
            if (!rename($temp, $file)) throw new RuntimeException('No se pudo reemplazar atómicamente el cierre.', 500);
            return $this->load($month) ?? throw new RuntimeException('No se pudo releer el cierre.', 500);
        } finally {
            if (is_file($temp)) unlink($temp);
        }
    }

    public function validate(mixed $data, int $month): void
    {
        if (!is_array($data) || ($data['schemaVersion'] ?? null) !== 1 || ($data['anioConcurso'] ?? null) !== 2026
            || ($data['periodo'] ?? null) !== self::period($month)
            || !in_array($data['estado'] ?? null, ['ABIERTO', 'CERRADO'], true)
            || !is_int($data['version'] ?? null) || $data['version'] < 1
            || !is_string($data['fechaCierre'] ?? null) || $data['fechaCierre'] === ''
            || !is_array($data['cerradoPor'] ?? null) || !is_int($data['cerradoPor']['usuarioId'] ?? null)
            || !is_array($data['baseOficial'] ?? null) || !is_int($data['baseOficial']['version'] ?? null)
            || !is_string($data['baseOficial']['periodoDesde'] ?? null)
            || !is_string($data['baseOficial']['periodoHasta'] ?? null)
            || !preg_match('/^2026-(0[1-9]|1[0-2])$/', $data['baseOficial']['periodoDesde'])
            || !preg_match('/^2026-(0[1-9]|1[0-2])$/', $data['baseOficial']['periodoHasta'])
            || $data['baseOficial']['periodoDesde'] > $data['baseOficial']['periodoHasta']
            || !is_array($data['snapshot']['vendedores'] ?? null) || !$data['snapshot']['vendedores']) {
            throw new RuntimeException('Estructura general incorrecta.', 409);
        }
        if (array_key_exists('reglasMeta', $data)
            && (!is_array($data['reglasMeta']) || ($data['reglasMeta']['schemaVersion'] ?? null) !== 1
                || !is_int($data['reglasMeta']['version'] ?? null) || $data['reglasMeta']['version'] < 1
                || !is_string($data['reglasMeta']['fechaActualizacion'] ?? null))) {
            throw new RuntimeException('Versión de reglas Meta inválida.', 409);
        }
        if (array_key_exists('parametros', $data)
            && (!is_array($data['parametros']) || ($data['parametros']['schemaVersion'] ?? null) !== 1
                || !is_int($data['parametros']['version'] ?? null) || $data['parametros']['version'] < 1)) {
            throw new RuntimeException('Versión de parámetros inválida.', 409);
        }
        $baseMonths = array_map(static fn(int $value): string => sprintf('2026-%02d', $value),
            range((int)substr($data['baseOficial']['periodoDesde'], 5), (int)substr($data['baseOficial']['periodoHasta'], 5)));
        $seen = [];
        foreach ($data['snapshot']['vendedores'] as $vendor) {
            $id = $vendor['usuarioId'] ?? null;
            if (!is_int($id) || $id <= 0 || isset($seen[$id]) || !is_string($vendor['codigoPrincipal'] ?? null)
                || !is_string($vendor['vendedor'] ?? null) || !is_array($vendor['productos'] ?? null)
                || !is_array($vendor['clientes'] ?? null)) throw new RuntimeException('Vendedor inválido.', 409);
            if (!self::number($vendor['meta'] ?? null) || !self::number($vendor['venta'] ?? null)
                || !self::number($vendor['cumplimiento'] ?? null) || !is_string($vendor['tipo'] ?? null)
                || !is_string($vendor['tramo'] ?? null) || !is_array($vendor['desgloseVenta'] ?? null)) {
                throw new RuntimeException('Cumplimiento incompleto.', 409);
            }
            $seen[$id] = true;
            $sumProducts = 0;
            $categories = [];
            foreach ($vendor['productos'] as $category) {
                $name = $category['categoria'] ?? null;
                if (!in_array($name, self::CATEGORIES, true) || isset($categories[$name])
                    || !self::number($category['promedioBase'] ?? null) || !self::number($category['ventaMes'] ?? null)
                    || !is_int($category['puntos'] ?? null) || !is_array($category['baseMeses'] ?? null)
                    || !is_array($category['documentos'] ?? null)) throw new RuntimeException('Categoría inválida.', 409);
                $actualMonths = array_keys($category['baseMeses']);
                sort($actualMonths);
                if ($actualMonths !== $baseMonths) throw new RuntimeException('Detalle de Base Oficial incompleto.', 409);
                foreach ($category['baseMeses'] as $baseSale) if (!self::number($baseSale)) {
                    throw new RuntimeException('Venta de Base Oficial inválida.', 409);
                }
                if (!self::same(round(array_sum($category['baseMeses']) / count($baseMonths), 2), (float)$category['promedioBase'])) {
                    throw new RuntimeException('Promedio de Base Oficial no cuadra.', 409);
                }
                $categories[$name] = true;
                $sumProducts += $category['puntos'];
                $sale = 0.0;
                foreach ($category['documentos'] as $doc) {
                    if (!self::number($doc['atribuida'] ?? null) || !self::number($doc['original'] ?? null)
                        || !self::number($doc['porcentaje'] ?? null) || !is_array($doc['tipoAtribucion'] ?? null)
                        || !isset($doc['fecha'], $doc['tipo'], $doc['folio'], $doc['clienteCodigo'], $doc['codigoVendedor'], $doc['codigoProducto'], $doc['producto'])
                        || ($doc['categoriaConcurso'] ?? null) !== $name) {
                        throw new RuntimeException('Movimiento de producto inválido.', 409);
                    }
                    $sale += (float)$doc['atribuida'];
                }
                if (!self::same($sale, (float)$category['ventaMes'])) throw new RuntimeException('Venta de productos no cuadra.', 409);
            }
            if (count($categories) !== 4 || $sumProducts !== ($vendor['productosPuntos'] ?? null)) {
                throw new RuntimeException('Puntos o categorías de productos no cuadran.', 409);
            }
            foreach (['nuevos' => ['clientesNuevos', 'puntosNuevos', 5], 'recuperados' => ['clientesRecuperados', 'puntosRecuperados', 3]] as $kind => [$countKey, $pointsKey, $factor]) {
                if (!is_array($vendor['clientes'][$kind] ?? null)) throw new RuntimeException('Clientes incompletos.', 409);
                $qualified = 0;
                foreach ($vendor['clientes'][$kind] as $client) {
                    if (!is_array($client['folios'] ?? null) || !self::number($client['ventaMes'] ?? null)
                        || !is_bool($client['califica'] ?? null) || !is_int($client['puntos'] ?? null)
                        || !is_string($client['clienteCodigo'] ?? null) || !is_string($client['cliente'] ?? null)
                        || ($client['cantidadFolios'] ?? null) !== count($client['folios'])
                        || ($client['cantidadFolios'] === 0 && self::same((float)$client['ventaMes'], 0.0))
                        || ($kind === 'recuperados' && (!is_numeric($client['dias'] ?? null) || (int)$client['dias'] < 180))) {
                        throw new RuntimeException('Cliente inválido.', 409);
                    }
                    $total = 0.0;
                    foreach ($client['folios'] as $folio) {
                        if (!self::number($folio['atribuida'] ?? null)) throw new RuntimeException('Folio inválido.', 409);
                        $total += (float)$folio['atribuida'];
                    }
                    if (!self::same($total, (float)$client['ventaMes'])) throw new RuntimeException('Folios no cuadran.', 409);
                    if ($client['califica']) $qualified++;
                    if ($client['puntos'] !== ($client['califica'] ? $factor : 0)) throw new RuntimeException('Puntos de cliente inválidos.', 409);
                }
                if ($qualified !== ($vendor[$countKey] ?? null) || $qualified * $factor !== ($vendor[$pointsKey] ?? null)) {
                    throw new RuntimeException('Puntos de clientes no cuadran.', 409);
                }
            }
            if (!is_int($vendor['puntosMeta'] ?? null) || !is_int($vendor['totalMes'] ?? null)
                || $vendor['puntosMeta'] + $vendor['puntosNuevos'] + $vendor['puntosRecuperados'] + $vendor['productosPuntos'] !== $vendor['totalMes']) {
                throw new RuntimeException('Total Mes no cuadra.', 409);
            }
        }
    }

    private static function number(mixed $value): bool
    {
        return (is_int($value) || is_float($value)) && is_finite((float)$value);
    }

    private static function same(float $a, float $b): bool
    {
        return abs($a - $b) <= 0.011;
    }
}
