<?php
declare(strict_types=1);

require_once __DIR__ . '/ClienteClasificacionOverrideService.php';

/** Reglas puras compartidas: sin SQL, Concurso, puntos ni formatos particulares de cada módulo. */
final class ClienteClasificacionEfectivaService
{
    public static function clave(string $periodo, mixed $rut): ?string
    {
        try { return $periodo . '|' . ClienteClasificacionOverrideService::normalizarRut($rut); }
        catch (RuntimeException) { return null; }
    }

    /** Los adaptadores conservan la propiedad y materializan la evidencia en su propio contrato. */
    public static function planificar(array $nuevos, array $recuperados, array $overrides, callable $identidad, ?callable $unificar = null): array
    {
        $index = $includes = [];
        foreach ($overrides as $row) {
            if ((int)$row['activo'] !== 1) continue;
            $kind = $row['tipo_evento'] === 'NUEVO' ? 'nuevos' : 'recuperados';
            $key = self::clave($row['periodo'], $row['rut_normalizado']);
            if ($key === null) continue;
            if (($index[$key][$kind] ?? null) !== 'EXCLUIR') $index[$key][$kind] = $row['accion'];
            if ($row['accion'] === 'INCLUIR') $includes[] = [$kind, $key, $row];
        }
        $effective = ['nuevos' => $nuevos, 'recuperados' => $recuperados];
        foreach ($effective as $kind => &$events) {
            $opposite = $kind === 'nuevos' ? 'recuperados' : 'nuevos';
            foreach ($events as $id => $event) {
                $key = $identidad($event);
                if ($key === null) continue;
                $decisions = $index[$key] ?? [];
                if (($decisions[$kind] ?? null) === 'EXCLUIR' || ($decisions[$opposite] ?? null) === 'INCLUIR') unset($events[$id]);
            }
        }
        unset($events);
        $pending = [];
        foreach ($includes as [$kind, $key, $row]) {
            if ($index[$key][$kind] === 'EXCLUIR') continue;
            $matches = [];
            foreach ($effective[$kind] as $id => $event) if ($identidad($event) === $key) $matches[] = $id;
            if ($matches) {
                if (count($matches) > 1 && $unificar !== null) $unificar($effective[$kind], $matches);
                continue;
            }
            $pending[] = ['categoria' => $kind, 'override' => $row];
        }
        return $effective + ['inclusiones' => $pending];
    }

    /** La evidencia se valida una sola vez con las mismas reglas para ambos consumidores. */
    public static function evidencia(array $row): array
    {
        try { $evidence = json_decode((string)$row['datos_validacion'], true, 512, JSON_THROW_ON_ERROR); }
        catch (JsonException $error) { throw new RuntimeException('La inclusión manual ' . $row['id'] . ' no tiene evidencia válida.', 409, $error); }
        if (!is_array($evidence) || !is_numeric($evidence['monto'] ?? null) || !is_finite((float)$evidence['monto'])
            || !is_array($evidence['vendedorOrigen'] ?? null) || !is_array($evidence['compartidos'] ?? null)
            || ($evidence['fecha'] ?? null) !== $row['fecha_documento'] || substr((string)$row['fecha_documento'], 0, 7) !== $row['periodo']
            || (string)($evidence['codaux'] ?? '') !== $row['codaux'] || (string)($evidence['folio'] ?? '') !== $row['folio']
            || (string)($evidence['nroint'] ?? '') !== $row['nroint'] || $row['tipo_documento'] !== 'F'
            || !is_string($row['cliente_nombre']) || $row['cliente_nombre'] === '') {
            throw new RuntimeException('La inclusión manual ' . $row['id'] . ' tiene evidencia incompleta o inconsistente.', 409);
        }
        if (ClienteClasificacionOverrideService::normalizarRut($evidence['rut'] ?? null) !== $row['rut_normalizado']) throw new RuntimeException('El RUT de la evidencia manual no coincide.', 409);
        $vendor = $evidence['vendedorOrigen'];
        if ((string)($vendor['codigo'] ?? '') !== $row['codigo_vendedor_origen'] || !is_string($vendor['nombre'] ?? null)) throw new RuntimeException('Vendedor de la evidencia manual inválido.', 409);
        return $evidence;
    }
}
