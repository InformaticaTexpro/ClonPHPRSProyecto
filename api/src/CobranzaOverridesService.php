<?php
declare(strict_types=1);

/** Administración de excepciones; no interviene en report(), Concurso ni Dashboard. */
final class CobranzaOverridesService
{
    use SharedServiceHelpers;

    public const MOTIVOS = ['MISMO_RUT_OTRO_CODIGO', 'ACTIVIDAD_COMERCIAL_NO_REFLEJADA',
        'ATRIBUCION_COMERCIAL_ESPECIAL', 'CORRECCION_ADMINISTRATIVA', 'OTRO'];

    public function __construct(private Database $db, private AnalyticsService $analytics,
        private ClienteClasificacionOverrideService $overrides) {}

    public function route(array $payload, string $method, string $path, array $query = [], array $body = []): array
    {
        $id = $this->currentUserIdFromPayload($payload);
        $user = $this->db->fetchOne('SELECT id, nombre, is_admin FROM usuario WHERE id = ? AND is_active = 1', [$id]);
        if (!$user) throw new RuntimeException('Usuario no disponible.', 403);
        $menus = array_column(array_merge($payload['menus'] ?? [], $payload['menus_directos'] ?? []), 'codigo');
        $isAdmin = (bool)$user['is_admin'];
        if (!$isAdmin && !in_array('cobranza_control_clientes', $menus, true)) {
            throw new RuntimeException('Sin acceso a Control de Clientes.', 403);
        }
        $canManage = $isAdmin || in_array('administracion', $menus, true);
        $base = '/control-clientes/overrides';
        if ($method === 'GET' && $path === $base . '/permisos') {
            return ['ok' => true, 'puedeAdministrar' => $canManage, 'motivos' => self::MOTIVOS];
        }
        if (!$canManage) throw new RuntimeException('Se requiere acceso administrativo para gestionar excepciones.', 403);
        $actor = ['usuarioId' => $id, 'nombre' => (string)$user['nombre']];
        if ($method === 'GET' && $path === $base) {
            $filters = array_intersect_key($query, array_flip(['periodo', 'tipoEvento', 'rut', 'activo']));
            return ['ok' => true, 'items' => array_map(self::presentar(...), $this->overrides->listar($filters))];
        }
        if ($method === 'POST' && $path === $base . '/validar') return $this->validar($body);
        if ($method === 'POST' && $path === $base) {
            $reason = $body['motivoCodigo'] ?? null;
            $detail = $body['motivoDetalle'] ?? null;
            if (!is_string($reason) || !in_array($reason, self::MOTIVOS, true)) throw new RuntimeException('Motivo obligatorio o no admitido.', 400);
            if ($detail !== null && (!is_string($detail) || mb_strlen($detail) > 1000)) throw new RuntimeException('Observación inválida.', 400);
            if ($reason === 'OTRO' && trim((string)$detail) === '') throw new RuntimeException('Para OTRO debe indicar una observación.', 400);
            if (!in_array($body['accion'] ?? null, ['INCLUIR', 'EXCLUIR'], true)) throw new RuntimeException('Acción inválida.', 400);
            // Reconsulta obligatoria: ignora documentos, vendedor, evidencia y actor del cliente HTTP.
            $validation = $this->validar($body);
            if (!$validation['validado']) throw new RuntimeException($validation['mensaje'], 400);
            $doc = $validation['documento'];
            $client = $validation['cliente'];
            $evidence = ['folio' => $doc['folio'], 'nroint' => $doc['nroint'], 'fecha' => $doc['fecha'],
                'rut' => $client['rut'], 'codaux' => $client['codaux'], 'vendedorOrigen' => $validation['vendedor'],
                'monto' => $doc['monto'], 'compartidos' => $validation['compartidos']];
            $row = $this->overrides->crear(['periodo' => $body['periodo'], 'tipoEvento' => $body['tipoEvento'],
                'accion' => $body['accion'], 'rut' => $client['rut'], 'codaux' => $client['codaux'],
                'tipoDocumento' => $doc['tipo'], 'folio' => (string)$doc['folio'], 'nroint' => (string)$doc['nroint'],
                'fechaDocumento' => $doc['fecha'], 'clienteNombre' => $client['nombre'],
                'codigoVendedorOrigen' => $validation['vendedor']['codigo'], 'motivoCodigo' => $reason,
                'motivoDetalle' => $detail, 'datosValidacion' => $evidence], $actor);
            return ['ok' => true, 'item' => self::presentar($row)];
        }
        if ($method === 'POST' && $path === $base . '/revertir') {
            $overrideId = filter_var($body['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if ($overrideId === false || !is_string($body['motivo'] ?? null)) throw new RuntimeException('ID y motivo de reversión obligatorios.', 400);
            return ['ok' => true, 'item' => self::presentar($this->overrides->revertir($overrideId, $actor, $body['motivo']))];
        }
        throw new RuntimeException('Ruta administrativa no encontrada.', 404);
    }

    private static function presentar(array $row): array
    {
        return ['id' => (int)$row['id'], 'periodo' => $row['periodo'], 'tipoEvento' => $row['tipo_evento'],
            'accion' => $row['accion'], 'rut' => $row['rut_original'], 'rutNormalizado' => $row['rut_normalizado'],
            'codaux' => $row['codaux'], 'folio' => $row['folio'], 'cliente' => $row['cliente_nombre'],
            'motivoCodigo' => $row['motivo_codigo'], 'motivoDetalle' => $row['motivo_detalle'],
            'creadoPor' => $row['creado_por_nombre'], 'creadoEn' => $row['creado_en'], 'activo' => (bool)$row['activo'],
            'revertidoPor' => $row['revertido_por_nombre'], 'revertidoEn' => $row['revertido_en'],
            'motivoReversion' => $row['motivo_reversion']];
    }

    private function validar(array $data): array
    {
        $period = $data['periodo'] ?? null;
        if (!is_string($period) || !preg_match('/^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/D', $period)) throw new RuntimeException('Período inválido. Use YYYY-MM.', 400);
        if (!in_array($data['tipoEvento'] ?? null, ['NUEVO', 'RECUPERADO'], true)) throw new RuntimeException('Tipo evento inválido.', 400);
        $rut = ClienteClasificacionOverrideService::normalizarRut($data['rut'] ?? null);
        $codaux = $data['codaux'] ?? null;
        if (!is_string($codaux) || trim($codaux) === '' || mb_strlen($codaux) > 30) throw new RuntimeException('Código cliente obligatorio o inválido.', 400);
        $codaux = trim($codaux);
        if (!is_string($data['folio'] ?? null) && !is_int($data['folio'] ?? null)) throw new RuntimeException('Folio obligatorio o inválido.', 400);
        $folio = Security::validate_folio($data['folio']);
        $stmt = $this->db->softland()->prepare("SELECT h.Tipo AS tipo, h.Folio AS folio, h.NroInt AS nroint,
            CONVERT(varchar(10), h.Fecha, 23) AS fecha, LTRIM(RTRIM(h.CodAux)) AS codaux,
            LTRIM(RTRIM(h.CodVendedor)) AS codigoVendedor, LTRIM(RTRIM(h.Estado)) AS estado,
            CONVERT(varchar(80), c.RutAux) AS rut, RTRIM(COALESCE(c.NomAux, h.NomAux)) AS cliente
            FROM [PRODIN].[softland].[iw_gsaen] h LEFT JOIN [PRODIN].[softland].[cwtauxi] c ON c.CodAux = h.CodAux
            WHERE h.Folio = ?");
        $stmt->execute([$folio]);
        $docs = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $invalid = static fn(string $message): array => ['ok' => true, 'validado' => false, 'mensaje' => $message];
        if (!$docs) return $invalid('El folio no existe.');
        $invoices = array_values(array_filter($docs, static fn(array $d): bool => trim($d['tipo']) === 'F'));
        if (!$invoices) return $invalid('El documento no es una factura Tipo F.');
        $matching = array_values(array_filter($invoices, static fn(array $d): bool => $d['codaux'] === $codaux));
        if (!$matching) return $invalid('El folio no pertenece al CodAux indicado.');
        $matchingPeriod = array_values(array_filter($matching, static fn(array $d): bool => substr($d['fecha'], 0, 7) === $period));
        if (!$matchingPeriod) return $invalid('El documento no corresponde al período ' . $period . '.');
        if (count($matchingPeriod) !== 1) return $invalid('El folio identifica varias facturas. Debe resolver la ambigüedad antes de registrar la excepción.');
        $doc = $matchingPeriod[0];
        if (strtoupper($doc['estado']) === 'A') return $invalid('El documento está anulado.');
        try { $sourceRut = ClienteClasificacionOverrideService::normalizarRut(trim((string)$doc['rut'])); }
        catch (RuntimeException) { return $invalid('El cliente del documento no tiene un RUT válido en Softland.'); }
        if ($sourceRut !== $rut) return $invalid('El RUT ingresado no corresponde al cliente del documento.');
        $stmt = $this->db->softland()->prepare("SELECT SUM(ABS(COALESCE(m.TotLinea, 0))) AS monto
            FROM [PRODIN].[softland].[iw_gmovi] m INNER JOIN [PRODIN].[softland].[iw_tprod] t ON t.CodProd = m.CodProd
            WHERE m.NroInt = ? AND m.Tipo = 'F'");
        $stmt->execute([$doc['nroint']]);
        $amount = $stmt->fetchColumn();
        if ($amount === false || $amount === null || !is_numeric($amount)) return $invalid('La factura no tiene movimientos comerciales verificables.');
        $relations = $this->db->fetchAll("SELECT u.id AS usuarioId, u.nombre, uv.cod_vendedor AS codigo
            FROM usuario u INNER JOIN usuario_vendedor uv ON uv.usuario_id = u.id");
        $vendor = function (string $code) use ($relations): array {
            $names = [];
            foreach ($relations as $r) if ($this->analytics->sharedCodeKey($r['codigo']) === $this->analytics->sharedCodeKey($code)) $names[] = $r['nombre'];
            return ['codigo' => $code, 'nombre' => implode(' / ', array_unique($names)) ?: $code];
        };
        $until = (new DateTimeImmutable($period . '-01'))->modify('+1 month')->format('Y-m-d');
        $shared = [];
        foreach ($this->db->fetchAll("SELECT folio, porcentaje, cod_vendedor_principal AS origen, cod_vendedor_compartido AS destino
            FROM factura_compartida WHERE rol = 'compartido' AND fecha >= ? AND fecha < ? AND folio = ?",
            [$period . '-01', $until, $folio]) as $share) {
            if ($this->analytics->sharedCodeKey($share['origen']) !== $this->analytics->sharedCodeKey($doc['codigoVendedor'])) continue;
            $shared[] = $vendor((string)$share['destino']) + ['porcentaje' => (float)$share['porcentaje']];
        }
        $originVendor = $vendor($doc['codigoVendedor']);
        $originVendor['porcentaje'] = 100.0 - array_sum(array_column($shared, 'porcentaje'));
        $active = $this->overrides->buscarVigente($period, $data['tipoEvento'], $sourceRut);
        return ['ok' => true, 'validado' => true, 'overrideVigente' => $active === null ? null : self::presentar($active),
            'documento' => ['tipo' => 'F', 'folio' => (string)$doc['folio'], 'nroint' => (string)$doc['nroint'],
                'fecha' => $doc['fecha'], 'estado' => $doc['estado'], 'monto' => (float)$amount],
            'cliente' => ['nombre' => trim((string)$doc['cliente']), 'codaux' => $doc['codaux'], 'rut' => trim($doc['rut']), 'rutNormalizado' => $sourceRut],
            'vendedor' => $originVendor, 'compartidos' => $shared];
    }
}
