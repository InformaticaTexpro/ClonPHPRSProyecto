<?php
declare(strict_types=1);

/** Persistencia administrativa global. No consulta Softland ni calcula clientes o puntos. */
final class ClienteClasificacionOverrideService
{
    public function __construct(private Database $db) {}

    public function buscarVigente(string $periodo, string $tipoEvento, string $rut): ?array
    {
        $rows = $this->listar(['periodo' => $periodo, 'tipoEvento' => $tipoEvento, 'rut' => $rut, 'activo' => 1]);
        if (count($rows) > 1) throw new RuntimeException('Existen varios overrides activos para el mismo evento. Revisar el historial.', 409);
        return $rows[0] ?? null;
    }

    /** Devuelve filas con los nombres de columnas de auditoría de la tabla. */
    public function listar(array $filtros = []): array
    {
        $where = $params = [];
        foreach ($filtros as $key => $value) {
            if ($key === 'periodoDesde' || $key === 'periodoHasta') {
                $where[] = 'periodo ' . ($key === 'periodoDesde' ? '>=' : '<=') . ' ?';
                $params[] = self::periodo($value);
                continue;
            }
            [$column, $value] = match ($key) {
                'periodo' => ['periodo', self::periodo($value)],
                'tipoEvento', 'tipo_evento' => ['tipo_evento', self::opcion($value, ['NUEVO', 'RECUPERADO'], 'tipoEvento')],
                'accion' => ['accion', self::opcion($value, ['INCLUIR', 'EXCLUIR'], 'accion')],
                'rut', 'rutNormalizado', 'rut_normalizado' => ['rut_normalizado', self::normalizarRut($value)],
                'activo' => ['activo', self::activo($value)],
                'codaux', 'folio' => [$key, self::texto($value, 30, $key, true)],
                default => throw new RuntimeException('Filtro no admitido: ' . $key, 400),
            };
            $where[] = "$column = ?";
            $params[] = $value;
        }
        $stmt = $this->db->mysql()->prepare('SELECT * FROM cliente_clasificacion_override'
            . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY creado_en DESC, id DESC');
        $stmt->execute($params);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function resolver(string $periodo, string $tipoEvento, string $rut): array
    {
        $override = $this->buscarVigente($periodo, $tipoEvento, $rut);
        $accion = $override['accion'] ?? null;
        return ['override' => $override, 'accion' => $accion,
            'forzarInclusion' => $accion === 'INCLUIR', 'forzarExclusion' => $accion === 'EXCLUIR'];
    }

    /** Acepta campos camelCase o sus nombres de columna; nunca toma auditoría del payload. */
    public function crear(array $datos, array $actor): array
    {
        $periodo = self::periodo($datos['periodo'] ?? null);
        $tipo = self::opcion($datos['tipoEvento'] ?? $datos['tipo_evento'] ?? null, ['NUEVO', 'RECUPERADO'], 'tipoEvento');
        $accion = self::opcion($datos['accion'] ?? null, ['INCLUIR', 'EXCLUIR'], 'accion');
        $original = self::texto($datos['rut'] ?? $datos['rutOriginal'] ?? $datos['rut_original']
            ?? $datos['rutNormalizado'] ?? $datos['rut_normalizado'] ?? null, 20, 'rut', true);
        $rut = self::normalizarRut($original);
        foreach (['rutOriginal', 'rut_original', 'rutNormalizado', 'rut_normalizado'] as $key) {
            if (isset($datos[$key]) && self::normalizarRut($datos[$key]) !== $rut) {
                throw new RuntimeException('Los RUT recibidos no coinciden.', 400);
            }
        }
        [$actorId, $actorNombre] = self::actor($actor);
        $values = ['periodo' => $periodo, 'tipo_evento' => $tipo, 'accion' => $accion,
            'rut_normalizado' => $rut, 'rut_original' => $original];
        foreach ([
            'codaux' => ['codaux', 30], 'tipo_documento' => ['tipoDocumento', 5],
            'folio' => ['folio', 30], 'nroint' => ['nroint', 30],
            'cliente_nombre' => ['clienteNombre', 255], 'codigo_vendedor_origen' => ['codigoVendedorOrigen', 30],
            'motivo_codigo' => ['motivoCodigo', 80], 'motivo_detalle' => ['motivoDetalle', 1000],
        ] as $column => [$alias, $max]) {
            $values[$column] = self::texto($datos[$alias] ?? $datos[$column] ?? null, $max, $column, $column === 'motivo_codigo');
        }
        $fecha = self::texto($datos['fechaDocumento'] ?? $datos['fecha_documento'] ?? null, 10, 'fecha_documento');
        if ($fecha !== null) {
            $date = DateTimeImmutable::createFromFormat('!Y-m-d', $fecha);
            if ($date === false || $date->format('Y-m-d') !== $fecha) throw new RuntimeException('fecha_documento inválida.', 400);
        }
        $values['fecha_documento'] = $fecha;
        $evidence = $datos['datosValidacion'] ?? $datos['datos_validacion'] ?? null;
        try {
            if (is_array($evidence)) $evidence = json_encode($evidence, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
            elseif ($evidence !== null) {
                if (!is_string($evidence)) throw new RuntimeException('datos_validacion debe contener JSON.', 400);
                json_decode($evidence, true, 512, JSON_THROW_ON_ERROR);
            }
        } catch (JsonException $error) {
            throw new RuntimeException('datos_validacion debe contener JSON válido.', 400, $error);
        }
        $values['datos_validacion'] = $evidence;
        $values['creado_por'] = $actorId;
        $values['creado_por_nombre'] = $actorNombre;

        return $this->transaccion($periodo, $rut, function (PDO $pdo, string $lockSuffix) use ($values, $periodo, $rut, $tipo, $accion): array {
            $stmt = $pdo->prepare('SELECT * FROM cliente_clasificacion_override WHERE periodo = ? AND rut_normalizado = ? AND activo = 1' . $lockSuffix);
            $stmt->execute([$periodo, $rut]);
            $active = $stmt->fetchAll(PDO::FETCH_ASSOC);
            foreach ($active as $row) {
                if ($row['tipo_evento'] === $tipo) {
                    throw new RuntimeException($row['accion'] === $accion
                        ? 'Ya existe un override activo equivalente.'
                        : 'Existe un override activo contrario. Debe revertirlo antes de crear uno nuevo.', 409);
                }
            }
            foreach ($active as $row) {
                if ($accion === 'INCLUIR' && $row['accion'] === 'INCLUIR') {
                    throw new RuntimeException('El cliente ya posee una inclusión manual activa como ' . $row['tipo_evento'] . ' para este período.', 409);
                }
            }
            $columns = array_keys($values);
            $stmt = $pdo->prepare('INSERT INTO cliente_clasificacion_override (' . implode(', ', $columns) . ') VALUES ('
                . implode(', ', array_fill(0, count($columns), '?')) . ')');
            $stmt->execute(array_values($values));
            return $this->porId($pdo, (int)$pdo->lastInsertId());
        });
    }

    public function revertir(int $id, array $actor, string $motivo): array
    {
        if ($id <= 0) throw new RuntimeException('ID inválido.', 400);
        [$actorId, $actorNombre] = self::actor($actor);
        $motivo = self::texto($motivo, 1000, 'motivo_reversion', true);
        $row = $this->porId($this->db->mysql(), $id);
        return $this->transaccion($row['periodo'], $row['rut_normalizado'], function (PDO $pdo, string $lockSuffix) use ($id, $actorId, $actorNombre, $motivo): array {
            $row = $this->porId($pdo, $id, $lockSuffix);
            if ((int)$row['activo'] !== 1) throw new RuntimeException('El override ya fue revertido.', 409);
            $stmt = $pdo->prepare('UPDATE cliente_clasificacion_override SET activo = 0, revertido_por = ?, '
                . 'revertido_por_nombre = ?, revertido_en = CURRENT_TIMESTAMP, motivo_reversion = ? WHERE id = ? AND activo = 1');
            $stmt->execute([$actorId, $actorNombre, $motivo, $id]);
            return $this->porId($pdo, $id);
        });
    }

    private function porId(PDO $pdo, int $id, string $suffix = ''): array
    {
        $stmt = $pdo->prepare('SELECT * FROM cliente_clasificacion_override WHERE id = ?' . $suffix);
        $stmt->execute([$id]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: throw new RuntimeException('Override no encontrado.', 404);
    }

    /**
     * GET_LOCK serializa ambos tipos del mismo período/RUT, incluso si no existen filas.
     * Evita depender de gap locks o del aislamiento configurado sin añadir un UNIQUE.
     * La operación administra su propia transacción; no confirma transacciones del llamador.
     */
    private function transaccion(string $periodo, string $rut, callable $operation): array
    {
        $pdo = $this->db->mysql();
        if ($pdo->inTransaction()) throw new RuntimeException('El servicio requiere una transacción propia.', 409);
        $mysql = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
        $lock = 'cco:' . substr(hash('sha256', $periodo . ':' . $rut), 0, 60);
        if ($mysql) {
            $stmt = $pdo->prepare('SELECT GET_LOCK(?, 10)');
            $stmt->execute([$lock]);
            if ((int)$stmt->fetchColumn() !== 1) throw new RuntimeException('No se pudo bloquear el evento. Intente nuevamente.', 409);
        }
        try {
            $pdo->beginTransaction();
            try {
                $result = $operation($pdo, $mysql ? ' FOR UPDATE' : '');
                $pdo->commit();
                return $result;
            } catch (Throwable $error) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $error;
            }
        } finally {
            if ($mysql) {
                $stmt = $pdo->prepare('SELECT RELEASE_LOCK(?)');
                $stmt->execute([$lock]);
            }
        }
    }

    /** Criterio compartido con la validación administrativa de documentos. */
    public static function normalizarRut(mixed $rut): string
    {
        $original = self::texto($rut, 20, 'rut', true);
        $normalized = strtoupper(str_replace(['.', '-', ' '], '', $original));
        if (!preg_match('/^[0-9]{1,19}[0-9K]$/D', $normalized)) throw new RuntimeException('RUT inválido o ausente.', 400);
        return $normalized;
    }

    private static function periodo(mixed $periodo): string
    {
        if (!is_string($periodo) || !preg_match('/^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/D', $periodo)) {
            throw new RuntimeException('Período inválido. Use YYYY-MM.', 400);
        }
        return $periodo;
    }

    private static function opcion(mixed $value, array $allowed, string $field): string
    {
        if (!is_string($value) || !in_array($value, $allowed, true)) throw new RuntimeException($field . ' inválido.', 400);
        return $value;
    }

    private static function texto(mixed $value, int $max, string $field, bool $required = false): ?string
    {
        if ($value === null && !$required) return null;
        if (!is_string($value) || mb_strlen($value, 'UTF-8') > $max || ($required && trim($value) === '')) {
            throw new RuntimeException($field . ' inválido o vacío.', 400);
        }
        return trim($value);
    }

    private static function activo(mixed $value): int
    {
        if (!in_array($value, [0, 1, '0', '1'], true)) throw new RuntimeException('activo inválido.', 400);
        return (int)$value;
    }

    private static function actor(array $actor): array
    {
        $id = filter_var($actor['usuarioId'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($id === false) throw new RuntimeException('usuarioId del actor inválido.', 400);
        return [$id, self::texto($actor['nombre'] ?? null, 255, 'nombre del actor', true)];
    }
}
