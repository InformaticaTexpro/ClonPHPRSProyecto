<?php
declare(strict_types=1);

final class VentaCompartidaAssignmentService
{
    use SharedServiceHelpers;

    public function __construct(private Database $db) {}

    public function receptores(array $payload): array
    {
        return (new AnalyticsService($this->db))->vendedoresTodos($payload)['vendedores'];
    }

    private function receptor(array $payload, mixed $code): array
    {
        $code = Security::validate_cod_vendedor($code);
        foreach ($this->receptores($payload) as $vendor) if ($vendor['cod'] === $code) return $vendor;
        throw new RuntimeException('Seleccione un vendedor receptor activo de la lista.', 400);
    }

    private function folio(int $folio, array $codes, ?array $identity): array
    {
        if (!$codes) throw new RuntimeException('No autorizado', 403);
        $placeholders = implode(',', array_fill(0, count($codes), '?'));
        $amount = $this->commercialAmountSql('h.Tipo', 'm.TotLinea');
        $where = ''; $params = array_merge([$folio], $codes);
        if ($identity !== null) {
            $date = $identity['fecha'] ?? null;
            $parsed = is_string($date) ? DateTimeImmutable::createFromFormat('!Y-m-d', $date) : false;
            if (!$parsed || $parsed->format('Y-m-d') !== $date) throw new RuntimeException('Fecha inválida.', 400);
            $where = ' AND h.Fecha >= ? AND h.Fecha < ?';
            array_push($params, $date, $parsed->modify('+1 day')->format('Y-m-d'));
            if (isset($identity['tipo'])) {
                if (!in_array($identity['tipo'], ['F','N','D'], true)) throw new RuntimeException('Tipo de documento inválido.', 400);
                $where .= ' AND h.Tipo = ?'; $params[] = $identity['tipo'];
            }
        }
        $stmt = $this->db->softland()->prepare("SELECT h.Folio, CONVERT(varchar(10),h.Fecha,23) AS Fecha, h.Tipo, h.CodVendedor,
                COALESCE(NULLIF(LTRIM(RTRIM(CONVERT(varchar(max),c.NomAux))),''),LTRIM(RTRIM(h.CodAux))) AS cliente,
                SUM($amount) AS montoBase
            FROM [PRODIN].[softland].[iw_gsaen] h
            LEFT JOIN [PRODIN].[softland].[cwtauxi] c ON c.CodAux = h.CodAux
            INNER JOIN [PRODIN].[softland].[iw_gmovi] m ON m.NroInt = h.NroInt AND m.Tipo = h.Tipo
            WHERE h.Folio = ? AND h.CodVendedor IN ($placeholders)
                AND h.Tipo IN ('F','N','D') AND h.Estado <> 'A' $where
            GROUP BY h.Folio,h.Fecha,h.Tipo,h.CodVendedor,h.CodAux,CONVERT(varchar(max),c.NomAux)");
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        if (!$rows) throw new RuntimeException('Folio no encontrado o no autorizado', 404);
        if ($identity !== null && count($rows) !== 1) throw new RuntimeException('Documento ambiguo. Seleccione tipo, fecha y origen exactos.', 409);
        return $rows[0];
    }

    private function assignment(int $id, array $codes, bool $lock = false): array
    {
        $where = ''; $params = [$id];
        if ($codes) { $where = ' AND cod_vendedor_principal IN (' . implode(',', array_fill(0, count($codes), '?')) . ')'; $params = array_merge($params, $codes); }
        $row = $this->db->fetchOne("SELECT id, folio, fecha, mes, anio, cod_vendedor_principal, usuario_id
            FROM factura_compartida WHERE id = ? AND rol = 'compartido' $where LIMIT 1" . ($lock ? ' FOR UPDATE' : ''), $params);
        if (!$row) throw new RuntimeException('Asignación no encontrada', 404);
        return $row;
    }

    // Bloquea una fila estable incluso cuando todavía no hay asignaciones para el folio.
    // Ambos flujos toman el mismo bloqueo antes de sumar/escribir porcentajes.
    private function locked(string $origin, callable $write): array
    {
        $connection = $this->db->mysql();
        $connection->beginTransaction();
        try {
            $owners = $this->db->fetchAll("SELECT u.id FROM usuario u INNER JOIN usuario_vendedor uv ON uv.usuario_id = u.id
                WHERE TRIM(uv.cod_vendedor) = ? ORDER BY u.id FOR UPDATE", [$origin]);
            if (!$owners) throw new RuntimeException('Vendedor de origen no encontrado.', 404);
            $result = $write(); $connection->commit(); return $result;
        } catch (Throwable $error) { if ($connection->inTransaction()) $connection->rollBack(); throw $error; }
    }

    private function assertSharedPercentageAvailable(string $folio, string $origin, int $month, int $year, float $percentage, ?int $exclude = null): void
    {
        // Lectura bloqueante actual: no usa un snapshot previo de la transacción.
        $sql = "SELECT id, porcentaje FROM factura_compartida WHERE folio = ? AND TRIM(cod_vendedor_principal) = TRIM(?)
            AND mes = ? AND anio = ? AND rol = 'compartido'";
        $params = [$folio, $origin, $month, $year];
        if ($exclude !== null) { $sql .= ' AND id <> ?'; $params[] = $exclude; }
        $assigned = array_sum(array_column($this->db->fetchAll($sql . ' FOR UPDATE', $params), 'porcentaje'));
        if ($assigned + $percentage > 100.000001) throw new RuntimeException('La suma de participaciones del documento no puede superar 100%.', 400);
    }

    public static function restante(float $sale, float $percentage, float $assigned): array
    {
        return ['porcentajeRestante' => max(0, 100 - $percentage), 'montoRestanteOriginal' => $sale - $assigned];
    }

    public function crear(array $payload, array $body, array $authorizedCodes, ?array $identity = null, bool $administrative = false): array
    {
        $actor = $this->currentUserIdFromPayload($payload);
        $folio = Security::validate_folio($body['folio'] ?? null);
        $recipient = $this->receptor($payload, $body['cod_vendedor_compartido'] ?? null);
        $percentage = Security::validate_porcentaje($body['porcentaje'] ?? null);
        $document = $this->folio($folio, $authorizedCodes, $identity);
        $date = substr((string)$document['Fecha'], 0, 10); $month = (int)substr($date, 5, 2); $year = (int)substr($date, 0, 4);
        $origin = trim((string)$document['CodVendedor']); $sale = (float)$document['montoBase'];
        $assigned = (int)round($sale * $percentage / 100);
        return $this->locked($origin, function () use ($payload, $actor, $folio, $recipient, $percentage, $document, $date, $month, $year, $origin, $sale, $assigned, $administrative): array {
            $this->assertSharedPercentageAvailable((string)$folio, $origin, $month, $year, $percentage);
            $this->db->execute("INSERT INTO factura_compartida
                (folio,anio,mes,fecha,cliente,monto_neto,monto_asignado,porcentaje,rol,cod_vendedor_principal,cod_vendedor_compartido,nombre_vendedor_compartido,fecha_registro,usuario_id)
                VALUES (?,?,?,?,?,?,?,?,'compartido',?,?,?,NOW(),?)",
                [(string)$folio,$year,$month,$date,$document['cliente'],$sale,$assigned,$percentage,$origin,$recipient['cod'],$recipient['nombre'],$actor]);
            $this->notify($payload, $folio, $document['cliente'], $recipient, $percentage, $assigned, $month, $year, $administrative);
            return ['ok' => true, 'message' => 'Folio compartido correctamente'];
        });
    }

    public function actualizar(array $payload, int $id, array $body, array $authorizedCodes = [], bool $administrative = false): array
    {
        $this->currentUserIdFromPayload($payload); Security::validate_id($id);
        $recipient = $this->receptor($payload, $body['cod_vendedor_compartido'] ?? null);
        $percentage = Security::validate_porcentaje($body['porcentaje'] ?? null);
        $row = $this->assignment($id, $authorizedCodes);
        $identity = ['fecha' => substr((string)$row['fecha'], 0, 10)];
        if (isset($body['tipo'])) $identity['tipo'] = $body['tipo'];
        $document = $this->folio(Security::validate_folio($row['folio']), [$row['cod_vendedor_principal']], $identity);
        $sale = (float)$document['montoBase']; $assigned = (int)round($sale * $percentage / 100);
        return $this->locked($row['cod_vendedor_principal'], function () use ($payload, $id, $authorizedCodes, $row, $document, $recipient, $percentage, $sale, $assigned, $administrative): array {
            $this->assignment($id, $authorizedCodes, true);
            $this->assertSharedPercentageAvailable((string)$row['folio'], $row['cod_vendedor_principal'], (int)$row['mes'], (int)$row['anio'], $percentage, $id);
            $this->db->execute("UPDATE factura_compartida SET cod_vendedor_compartido = ?,nombre_vendedor_compartido = ?,porcentaje = ?,monto_neto = ?,monto_asignado = ? WHERE id = ? AND rol = 'compartido'",
                [$recipient['cod'],$recipient['nombre'],$percentage,$sale,$assigned,$id]);
            $this->notify($payload, (int)$row['folio'], $document['cliente'], $recipient, $percentage, $assigned, (int)$row['mes'], (int)$row['anio'], $administrative);
            return ['ok' => true, 'message' => 'Asignación actualizada'];
        });
    }

    private function notify(array $payload, int $folio, string $client, array $recipient, int $percentage, int $assigned, int $month, int $year, bool $administrative): void
    {
        $receiver = $this->db->fetchOne('SELECT usuario_id FROM usuario_vendedor WHERE TRIM(cod_vendedor) = ? LIMIT 1', [$recipient['cod']]);
        $actor = $this->currentUserIdFromPayload($payload);
        $name = trim((string)($payload['nombre'] ?? '')) ?: 'Usuario';
        $source = $administrative ? 'Gestión administrativa de ' : 'El coordinador ';
        $notifications = [[$actor, 'folio_asignado', "✅ Folio #$folio compartido con {$recipient['nombre']}", "El folio #$folio ($client) fue asignado a {$recipient['nombre']} con un $percentage% de participación."]];
        if ($receiver) $notifications[] = [(int)$receiver['usuario_id'], 'folio_recibido', "📥 Folio #$folio asignado a ti",
            $source . $name . " te asignó el folio #$folio ($client) por $" . number_format($assigned, 0, ',', '.') . " con un $percentage% de participación."];
        foreach ($notifications as [$user, $type, $title, $message]) $this->db->execute(
            'INSERT INTO notificaciones (usuario_id,tipo,titulo,mensaje,leida,folio,mes,anio,fecha_creacion) VALUES (?,?,?,?,0,?,?,?,NOW())',
            [$user,$type,$title,$message,$folio,$month,$year]);
    }
}
