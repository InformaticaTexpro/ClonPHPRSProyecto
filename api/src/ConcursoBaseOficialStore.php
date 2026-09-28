<?php
declare(strict_types=1);

final class ConcursoBaseOficialStore
{
    public const CATEGORIAS = ['QUIMICOS', 'ACCESORIOS', 'TRAT_AGUA', 'AEROSOLES'];
    private const FILE = __DIR__ . '/../storage/concurso-ventas-2026/base-oficial.json';

    public function load(): ?array
    {
        if (!is_file(self::FILE)) return null;
        $contents = file_get_contents(self::FILE);
        if ($contents === false) throw new RuntimeException('BASE OFICIAL INVÁLIDA: no se pudo leer el archivo.', 409);
        try {
            $data = json_decode($contents, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException $e) {
            throw new RuntimeException('BASE OFICIAL INVÁLIDA: JSON corrupto.', 409, $e);
        }
        $this->validate($data);
        return $data;
    }

    public function save(array $data, bool $replace = false): array
    {
        $dir = dirname(self::FILE);
        if (!is_dir($dir) && !mkdir($dir, 0770, true) && !is_dir($dir)) {
            throw new RuntimeException('No se pudo crear el directorio privado de la base oficial.', 500);
        }
        if (!is_writable($dir)) throw new RuntimeException('El directorio de la base oficial no tiene permiso de escritura.', 500);
        $lock = fopen($dir . '/.base-oficial.lock', 'c');
        if ($lock === false || !flock($lock, LOCK_EX)) throw new RuntimeException('No se pudo bloquear la base oficial.', 500);
        try {
            $current = $this->load();
            if ($current !== null && !$replace) throw new RuntimeException('La base oficial 2026 ya existe. Confirme su reemplazo.', 409);
            $data['version'] = ($current['version'] ?? 0) + 1;
            $this->validate($data);
            $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            $temp = $dir . '/base-oficial.tmp';
            $stream = fopen($temp, 'wb');
            if ($stream === false) throw new RuntimeException('No se pudo escribir el archivo temporal de la base oficial.', 500);
            try {
                if (fwrite($stream, $json . "\n") !== strlen($json) + 1 || !fflush($stream)) {
                    throw new RuntimeException('No se pudo completar el archivo temporal de la base oficial.', 500);
                }
            } finally {
                fclose($stream);
            }
            if (json_decode((string)file_get_contents($temp), true, 512, JSON_THROW_ON_ERROR) !== $data) {
                throw new RuntimeException('El archivo temporal de la base oficial no coincide con el cálculo.', 500);
            }
            if (!rename($temp, self::FILE)) throw new RuntimeException('No se pudo reemplazar atómicamente la base oficial.', 500);
            return $this->load() ?? throw new RuntimeException('No se pudo releer la base oficial.', 500);
        } finally {
            if (isset($temp) && is_file($temp)) unlink($temp);
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    private function validate(mixed $data): void
    {
        if (!is_array($data) || ($data['schemaVersion'] ?? null) !== 1 || ($data['anioConcurso'] ?? null) !== 2026
            || !is_int($data['version'] ?? null) || $data['version'] < 1
            || !is_string($data['fechaGeneracion'] ?? null) || $data['fechaGeneracion'] === ''
            || !is_array($data['vendedores'] ?? null) || !$data['vendedores']
            || ($data['categorias'] ?? null) !== self::CATEGORIAS) {
            throw new RuntimeException('BASE OFICIAL INVÁLIDA: estructura general incorrecta.', 409);
        }
        $desde = $data['periodoDesde'] ?? null;
        $hasta = $data['periodoHasta'] ?? null;
        if (!is_string($desde) || !is_string($hasta) || !preg_match('/^2026-(0[1-9]|1[0-2])$/', $desde)
            || !preg_match('/^2026-(0[1-9]|1[0-2])$/', $hasta) || $desde > $hasta
            || ($data['cantidadMeses'] ?? null) !== (int)substr($hasta, 5) - (int)substr($desde, 5) + 1) {
            throw new RuntimeException('BASE OFICIAL INVÁLIDA: período incorrecto.', 409);
        }
        $months = array_map(static fn(int $month): string => sprintf('2026-%02d', $month), range((int)substr($desde, 5), (int)substr($hasta, 5)));
        $seen = [];
        foreach ($data['vendedores'] as $vendor) {
            $id = $vendor['usuarioId'] ?? null;
            if (!is_int($id) || $id <= 0 || isset($seen[$id]) || !is_string($vendor['codigoPrincipal'] ?? null)
                || !is_string($vendor['vendedorNombre'] ?? null) || trim($vendor['vendedorNombre']) === ''
                || !is_array($vendor['categorias'] ?? null)) {
                throw new RuntimeException('BASE OFICIAL INVÁLIDA: vendedor incorrecto.', 409);
            }
            $seen[$id] = true;
            foreach ($vendor['categorias'] as $category => $values) {
                $actualMonths = is_array($values['meses'] ?? null) ? array_keys($values['meses']) : [];
                sort($actualMonths);
                if (!in_array($category, self::CATEGORIAS, true) || !is_array($values)
                    || !self::validDecimal($values['promedioBase'] ?? null) || !is_array($values['meses'] ?? null)
                    || $actualMonths !== $months) {
                    throw new RuntimeException('BASE OFICIAL INVÁLIDA: categoría o meses incorrectos.', 409);
                }
                foreach ($values['meses'] as $sale) if (!self::validDecimal($sale)) {
                    throw new RuntimeException('BASE OFICIAL INVÁLIDA: venta mensual incorrecta.', 409);
                }
            }
        }
    }

    private static function validDecimal(mixed $value): bool
    {
        return (is_string($value) && (bool)preg_match('/^-?\d+\.\d{2}$/', $value))
            || ((is_int($value) || is_float($value)) && is_finite((float)$value));
    }
}
