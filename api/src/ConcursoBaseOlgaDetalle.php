<?php
declare(strict_types=1);

/** Fuente de consulta privada: nunca se utiliza en el motor ni en los cierres. */
final class ConcursoBaseOlgaDetalle
{
    public static function load(): array
    {
        $file = __DIR__ . '/../storage/concurso-ventas-2026/privado/base-usuario-49.json';
        if (!is_readable($file)) throw new RuntimeException('Detalle privado no disponible.', 404);
        $data = json_decode((string)file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
        if (($data['usuarioId'] ?? null) !== 49 || !is_array($data['resumenMensual'] ?? null)
            || !is_array($data['baseOficial'] ?? null) || !is_array($data['movimientos'] ?? null)) {
            throw new RuntimeException('Fuente privada de Olga inválida.', 409);
        }
        // Adaptación de lectura al contrato existente; no se modifica ni recalcula la fuente.
        $data['resumen'] = [];
        foreach ($data['resumenMensual'] as $row) {
            $category = $row['categoria'];
            $data['resumen'][$category] = [
                'meses' => ['2026-07' => $row['julio'], '2026-08' => $row['agosto'], '2026-09' => $row['septiembre']],
                'acumuladoComputable' => $row['acumulado'], 'baseOficial' => $data['baseOficial'][$category],
            ];
        }
        $data['divisor'] = $data['reglaCalculo']['divisorBase'];
        return $data;
    }

    public static function documentos(array $movimientos, string $category, int $month): array
    {
        if (!in_array($month, [7, 8, 9], true)) throw new RuntimeException('Mes fuera del respaldo privado de Olga.', 400);
        $documents = [];
        foreach ($movimientos as $item) {
            $itemMonth = is_numeric($item['mes']) ? (int)$item['mes'] : (int)substr((string)$item['mes'], 5, 2);
            if ($itemMonth !== $month || $item['categoria'] !== $category) continue;
            $code = (string)($item['codigoVendedor'] ?? $item['vendedor']);
            $factor = (float)($item['factorAplicado'] ?? ((float)$item['porcentajeReconocido'] / 100));
            $participation = $item['tipoParticipacion'] ?? 'BASE PRIVADA';
            $documents[] = ['fecha' => $item['fecha'], 'tipo' => $item['tipo'], 'folio' => $item['folio'],
                'cliente' => $item['cliente'] ?? '', 'codigoVendedor' => $code,
                'codigoProducto' => $item['codigoProducto'] ?? $item['producto'],
                'producto' => $item['descripcion'] ?? $item['producto'], 'cantidad' => $item['cantidad'] ?? 0,
                'tipoAtribucion' => is_array($participation) ? $participation : [(string)$participation],
                'tipoCodigo' => $code === '8479' ? 'C' : 'P', 'porcentaje' => $factor * 100,
                'categoriaOriginal' => $item['categoria'], 'categoriaConcurso' => $item['categoria'],
                'original' => $item['TotLinea'] ?? $item['totLinea'] ?? $item['totLineaOriginal'],
                'atribuida' => $item['montoComputableBase'] ?? $item['aporteComputable']];
        }
        return $documents;
    }

    public static function consulta(array $query = []): array
    {
        $data = self::load();
        $months = ['2026-07', '2026-08', '2026-09'];
        if (!isset($query['categoria'])) {
            $records = [];
            foreach ($data['resumen'] as $category => $values) $records[] = [
                'usuario_id' => 49, 'categoria' => $category, 'promedio_base' => $values['baseOficial'],
                'ventas_mensuales' => $values['meses'],
            ];
            return ['ok' => true, 'detalle' => $data, 'registros' => $records,
                'periodo' => ['periodo_desde' => $months[0], 'periodo_hasta' => $months[2], 'meses' => $months, 'cantidad_meses' => 3]];
        }
        $category = (string)$query['categoria'];
        if (!isset($data['resumen'][$category])) throw new RuntimeException('Categoría inválida.', 400);
        $values = $data['resumen'][$category];
        $response = ['ok' => true, 'baseManual' => false, 'fuenteBase' => 'PRIVADA',
            'promedioBase' => $values['baseOficial'],
            'observacion' => $data['movimientos'] ? 'Detalle de movimientos utilizados para el cálculo de la base oficial.' : ($data['observacion'] ?? ''),
            'detalleDisponible' => (bool)$data['movimientos']];
        if (!isset($query['periodo'])) {
            $response['meses'] = array_map(static fn(string $month): array => ['periodo' => $month, 'venta' => $values['meses'][$month]], $months);
            return $response;
        }
        $month = (string)$query['periodo'];
        if (!in_array($month, $months, true)) throw new RuntimeException('Mes fuera del respaldo privado de Olga.', 400);
        if (!$data['movimientos'] && ($data['estadoDetalle'] ?? '') === 'PENDIENTE_FUENTE') {
            throw new RuntimeException('La fuente privada completa de Olga todavía no está instalada. No se pueden consultar sus movimientos.', 409);
        }
        $documents = self::documentos($data['movimientos'], $category, (int)substr($month, 5, 2));
        $total = array_sum(array_column($documents, 'atribuida'));
        return $response + ['periodo' => $month, 'documentos' => $documents, 'total' => $total,
            'importeOficial' => $values['meses'][$month], 'coincide' => abs($total - $values['meses'][$month]) < .005];
    }
}
