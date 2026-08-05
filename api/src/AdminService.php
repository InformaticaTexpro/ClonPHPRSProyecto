<?php
declare(strict_types=1);

final class AdminService
{
    private ?array $perfilSchemaCache = null;
    private ?array $areaSchemaCache = null;

    public function __construct(private Database $db)
    {
    }

    private function assertAdmin(array $payload): void
    {
        if (!(bool)($payload['is_admin'] ?? false)) {
            throw new RuntimeException('Solo administradores', 403);
        }
    }

    private function normalizeText(mixed $value): string
    {
        return trim((string)$value);
    }

    private function cleanCode(mixed $value): string
    {
        $text = $this->normalizeText($value);
        $text = mb_strtolower($text);
        $text = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $text) ?: $text;
        $text = preg_replace('/\s+/', '_', $text) ?? $text;
        $text = preg_replace('/[^a-z0-9_]/', '', $text) ?? $text;
        $text = preg_replace('/_+/', '_', $text) ?? $text;
        return trim($text, '_');
    }

    private function normalizeKey(mixed $value): string
    {
        $text = $this->normalizeText($value);
        $text = mb_strtolower($text);
        $text = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $text) ?: $text;
        $text = preg_replace('/\s+/', '-', $text) ?? $text;
        $text = preg_replace('/[^a-z0-9-]/', '', $text) ?? $text;
        $text = preg_replace('/-+/', '-', $text) ?? $text;
        return trim($text, '-');
    }

    private function asBoolean(mixed $value, mixed $fallback = null): ?bool
    {
        if ($value === null || $value === '') {
            return $fallback;
        }
        if (is_bool($value)) {
            return $value;
        }
        if (is_int($value) || is_float($value)) {
            return (int)$value !== 0;
        }
        $normalized = $this->normalizeKey($value);
        if (in_array($normalized, ['1', 'true', 'si', 'sí', 'yes', 'y', 'on'], true)) {
            return true;
        }
        if (in_array($normalized, ['0', 'false', 'no', 'off'], true)) {
            return false;
        }
        return $fallback;
    }

    private function asNumber(mixed $value, mixed $fallback = null): ?float
    {
        if ($value === null || $value === '') {
            return $fallback;
        }
        $num = is_numeric($value) ? (float)$value : NAN;
        return is_finite($num) ? $num : $fallback;
    }

    private function requireId(mixed $value, string $label = 'ID'): int
    {
        $num = $this->asNumber($value, null);
        if (!is_finite((float)$num) || (int)$num <= 0) {
            throw new RuntimeException($label . ' inválido', 400);
        }
        return (int)$num;
    }

    private function isValidEmail(mixed $value): bool
    {
        return (bool)filter_var($this->normalizeText($value), FILTER_VALIDATE_EMAIL);
    }

    private function isValidMenuUrl(mixed $value): bool
    {
        $text = $this->normalizeText($value);
        return $text !== '' && str_starts_with($text, '/') && (bool)preg_match('/\/index\.html(\?.*)?$/i', $text);
    }

    private function boolToDb(mixed $value, int $fallback = 0): int
    {
        $result = $this->asBoolean($value, null);
        if ($result === null) {
            return $fallback ? 1 : 0;
        }
        return $result ? 1 : 0;
    }

    private function withTransaction(callable $work): mixed
    {
        $pdo = $this->db->mysql();
        $pdo->beginTransaction();
        try {
            $result = $work($pdo);
            $pdo->commit();
            return $result;
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    private function formatAreaLabel(mixed $value): string
    {
        $normalized = $this->normalizeKey($value);
        $labels = [
            'ventas' => 'Ventas',
            'produccion' => 'Producción',
            'bodega' => 'Bodega',
            'servicio-tecnico' => 'Servicio Técnico',
            'facturacion' => 'Facturación',
            'contabilidad' => 'Contabilidad',
            'rrhh' => 'RRHH',
            'gerencia' => 'Gerencia',
            'administracion' => 'Administración',
            'admin' => 'Administración',
        ];
        return $labels[$normalized] ?? ($this->normalizeText($value) ?: 'Sin área');
    }

    private function mapMenuRow(array $row): array
    {
        return [
            'id' => (int)($row['id'] ?? 0),
            'codigo' => (string)($row['codigo'] ?? ''),
            'nombre' => (string)($row['nombre'] ?? ''),
            'url' => (string)($row['url'] ?? ''),
            'icono' => (string)($row['icono'] ?? ''),
            'grupo' => (string)($row['grupo'] ?? 'General'),
            'orden' => (int)($row['orden'] ?? 0),
            'activo' => (bool)($row['activo'] ?? 0),
        ];
    }

    private function mapProfileRow(array $row): array
    {
        return [
            'id' => (int)($row['id'] ?? 0),
            'codigo' => (string)($row['codigo'] ?? ''),
            'nombre' => (string)($row['nombre'] ?? ''),
            'descripcion' => (string)($row['descripcion'] ?? ''),
            'area' => (string)($row['area'] ?? ''),
            'es_base' => (bool)($row['es_base'] ?? 0),
            'activo' => (bool)($row['activo'] ?? 0),
        ];
    }

    private function mapAreaRow(array $row): array
    {
        return [
            'id' => (int)($row['id'] ?? 0),
            'codigo' => (string)($row['codigo'] ?? ''),
            'nombre' => (string)($row['nombre'] ?? ''),
            'descripcion' => (string)($row['descripcion'] ?? ''),
            'perfil_base_id' => isset($row['perfil_base_id']) && $row['perfil_base_id'] !== null ? (int)$row['perfil_base_id'] : null,
            'perfil_base_nombre' => (string)($row['perfil_base_nombre'] ?? ''),
            'perfil_base_codigo' => (string)($row['perfil_base_codigo'] ?? ''),
            'activo' => (bool)($row['activo'] ?? 0),
            'total_usuarios' => (int)($row['total_usuarios'] ?? 0),
            'total_usuarios_activos' => (int)($row['total_usuarios_activos'] ?? 0),
            'created_at' => $row['created_at'] ?? null,
            'updated_at' => $row['updated_at'] ?? null,
        ];
    }

    private function mapVendorRow(array $row): array
    {
        return [
            'cod_vendedor' => strtoupper($this->normalizeText($row['cod_vendedor'] ?? '')),
            'tipo' => strtoupper($this->normalizeText($row['tipo'] ?? '')),
        ];
    }

    private function mapUserRow(array $row): array
    {
        return [
            'id' => (int)($row['id'] ?? 0),
            'nombre' => (string)($row['nombre'] ?? ''),
            'email' => (string)($row['email'] ?? ''),
            'codigo' => (string)($row['codigo'] ?? ''),
            'area' => (string)($row['area'] ?? ''),
            'area_label' => $this->formatAreaLabel($row['area'] ?? ''),
            'is_admin' => (bool)($row['is_admin'] ?? 0),
            'is_active' => (bool)($row['is_active'] ?? 0),
            'last_login' => $row['last_login'] ?? null,
            'created_at' => $row['created_at'] ?? ($row['fecha_creacion'] ?? null),
            'vendedores' => $row['vendedores'] ?? [],
            'menus' => $row['menus'] ?? [],
            'menu_ids' => array_map(static fn(array $menu): int => (int)$menu['id'], $row['menus'] ?? []),
            'perfiles' => $row['perfiles'] ?? [],
            'perfil_ids' => array_map(static fn(array $perfil): int => (int)$perfil['id'], $row['perfiles'] ?? []),
        ];
    }

    private function resolveMenuPayload(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }
        if ($value === null || $value === '') {
            return [];
        }
        if (is_string($value) && str_contains($value, ',')) {
            return array_values(array_filter(array_map('trim', explode(',', $value))));
        }
        return [$value];
    }

    private function resolveProfilePayload(mixed $value): array
    {
        return $this->resolveMenuPayload($value);
    }

    private function getPerfilSchema(PDO $pdo): array
    {
        if ($this->perfilSchemaCache !== null) {
            return $this->perfilSchemaCache;
        }

        try {
            $hasArea = (bool)$pdo->query("SHOW COLUMNS FROM perfil LIKE 'area'")->fetch(PDO::FETCH_ASSOC);
            $hasEsBase = (bool)$pdo->query("SHOW COLUMNS FROM perfil LIKE 'es_base'")->fetch(PDO::FETCH_ASSOC);
            $this->perfilSchemaCache = ['hasArea' => $hasArea, 'hasEsBase' => $hasEsBase];
        } catch (Throwable) {
            $this->perfilSchemaCache = ['hasArea' => false, 'hasEsBase' => false];
        }

        return $this->perfilSchemaCache;
    }

    private function getAreaSchema(PDO $pdo): array
    {
        if ($this->areaSchemaCache !== null) {
            return $this->areaSchemaCache;
        }

        try {
            $row = $pdo->query("SHOW TABLES LIKE 'area'")->fetch(PDO::FETCH_NUM);
            $this->areaSchemaCache = ['exists' => (bool)$row];
        } catch (Throwable) {
            $this->areaSchemaCache = ['exists' => false];
        }

        return $this->areaSchemaCache;
    }

    private function loadMenus(PDO $pdo): array
    {
        $this->ensureCommonMenus($pdo);
        $rows = $pdo->query('SELECT id, codigo, nombre, url, icono, grupo, orden, activo FROM menu ORDER BY grupo ASC, orden ASC, nombre ASC')->fetchAll(PDO::FETCH_ASSOC);
        return array_map(fn(array $row): array => $this->mapMenuRow($row), $rows ?: []);
    }

    private function ensureCommonMenus(PDO $pdo): void
    {
        $menus = [
            ['codigo' => 'general', 'nombre' => 'General', 'grupo' => 'General', 'url' => '/src/modulo/general/general/index.html', 'icono' => '🧭', 'orden' => 0],
            ['codigo' => 'alertas', 'nombre' => 'Alertas', 'grupo' => 'General', 'url' => '/src/modulo/varios/alertas/index.html', 'icono' => '🔔', 'orden' => 1],
            ['codigo' => 'mensajeria', 'nombre' => 'Chat', 'grupo' => 'General', 'url' => '/src/modulo/varios/mensajeria/index.html', 'icono' => '💬', 'orden' => 2],
        ];

        $stmt = $pdo->prepare(
            'INSERT INTO menu (codigo, nombre, grupo, url, icono, orden, activo)
             VALUES (?, ?, ?, ?, ?, ?, 1)
             ON DUPLICATE KEY UPDATE
               nombre = VALUES(nombre),
               grupo = VALUES(grupo),
               url = VALUES(url),
               icono = VALUES(icono),
               orden = VALUES(orden),
               activo = VALUES(activo)'
        );

        foreach ($menus as $menu) {
            $stmt->execute([
                $menu['codigo'],
                $menu['nombre'],
                $menu['grupo'],
                $menu['url'],
                $menu['icono'],
                $menu['orden'],
            ]);
        }
    }

    private function loadMenuById(PDO $pdo, int $menuId): ?array
    {
        $stmt = $pdo->prepare('SELECT id, codigo, nombre, url, icono, grupo, orden, activo FROM menu WHERE id = ? LIMIT 1');
        $stmt->execute([$menuId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ? $this->mapMenuRow($row) : null;
    }

    private function loadProfiles(PDO $pdo, ?int $profileId = null): array
    {
        $schema = $this->getPerfilSchema($pdo);
        $params = [];
        $sql = 'SELECT p.id, p.codigo, p.nombre, p.descripcion, '
            . ($schema['hasArea'] ? 'p.area' : "'' AS area")
            . ', '
            . ($schema['hasEsBase'] ? 'p.es_base' : '0 AS es_base')
            . ', p.activo FROM perfil p';
        if ($profileId !== null) {
            $sql .= ' WHERE p.id = ?';
            $params[] = $profileId;
        }
        $sql .= ($schema['hasArea'] || $schema['hasEsBase'])
            ? ' ORDER BY ' . ($schema['hasEsBase'] ? 'p.es_base DESC, ' : '') . ($schema['hasArea'] ? 'p.area ASC, ' : '') . 'p.nombre ASC'
            : ' ORDER BY p.nombre ASC';

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $profiles = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        if (!$profiles) {
            return [];
        }

        $ids = array_map(static fn(array $row): int => (int)$row['id'], $profiles);
        $placeholders = implode(',', array_fill(0, count($ids), '?'));

        $stmtMenus = $pdo->prepare(
            "SELECT pm.perfil_id, m.id, m.codigo, m.nombre, m.url, m.icono, m.grupo, m.orden, m.activo
             FROM perfil_menu pm
             INNER JOIN menu m ON m.id = pm.menu_id
             WHERE pm.perfil_id IN ($placeholders)
               AND pm.activo = 1
             ORDER BY pm.perfil_id ASC, m.orden ASC, m.nombre ASC"
        );
        $stmtMenus->execute($ids);
        $menus = $stmtMenus->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $stmtUsers = $pdo->prepare(
            "SELECT up.perfil_id, u.id, u.nombre, u.email, u.area, u.codigo, u.is_active
             FROM usuario_perfil up
             INNER JOIN usuario u ON u.id = up.usuario_id
             WHERE up.perfil_id IN ($placeholders)
             ORDER BY up.perfil_id ASC, u.nombre ASC"
        );
        $stmtUsers->execute($ids);
        $users = $stmtUsers->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $menusByProfile = [];
        foreach ($menus as $row) {
            $key = (int)$row['perfil_id'];
            $menusByProfile[$key] ??= [];
            $menusByProfile[$key][] = $this->mapMenuRow($row);
        }

        $usersByProfile = [];
        foreach ($users as $row) {
            $key = (int)$row['perfil_id'];
            $usersByProfile[$key] ??= [];
            $usersByProfile[$key][] = [
                'id' => (int)$row['id'],
                'nombre' => (string)$row['nombre'],
                'email' => (string)$row['email'],
                'codigo' => (string)$row['codigo'],
                'area' => (string)$row['area'],
                'is_active' => (bool)$row['is_active'],
            ];
        }

        return array_map(function (array $profile) use ($menusByProfile, $usersByProfile): array {
            $mapped = $this->mapProfileRow($profile);
            $pid = $mapped['id'];
            $mapped['menus'] = $menusByProfile[$pid] ?? [];
            $mapped['usuarios'] = $usersByProfile[$pid] ?? [];
            $mapped['menu_ids'] = array_map(static fn(array $menu): int => (int)$menu['id'], $mapped['menus']);
            $mapped['usuario_ids'] = array_map(static fn(array $user): int => (int)$user['id'], $mapped['usuarios']);
            return $mapped;
        }, $profiles);
    }

    private function loadProfileById(PDO $pdo, int $profileId): ?array
    {
        $profiles = $this->loadProfiles($pdo, $profileId);
        return $profiles[0] ?? null;
    }

    private function loadUserProfiles(PDO $pdo, int $userId): array
    {
        $schema = $this->getPerfilSchema($pdo);
        $sql = 'SELECT p.id, p.codigo, p.nombre, p.descripcion, '
            . ($schema['hasArea'] ? 'p.area' : "'' AS area")
            . ', '
            . ($schema['hasEsBase'] ? 'p.es_base' : '0 AS es_base')
            . ', p.activo, up.activo AS asignado_activo
             FROM usuario_perfil up
             INNER JOIN perfil p ON p.id = up.perfil_id
             WHERE up.usuario_id = ? AND up.activo = 1 AND p.activo = 1';
        $sql .= ($schema['hasEsBase'] ? ' ORDER BY p.es_base DESC, ' : ' ORDER BY ');
        $sql .= ($schema['hasArea'] ? 'p.area ASC, ' : '');
        $sql .= 'p.nombre ASC';

        $stmt = $pdo->prepare($sql);
        $stmt->execute([$userId]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        return array_map(function (array $row): array {
            $mapped = $this->mapProfileRow($row);
            $mapped['asignado_activo'] = (bool)($row['asignado_activo'] ?? 0);
            return $mapped;
        }, $rows);
    }

    private function loadBaseProfileByArea(PDO $pdo, string $area): ?array
    {
        $areaRow = $this->loadAreaByCode($pdo, $area);
        if ($areaRow && $areaRow['perfil_base_id']) {
            $stmt = $pdo->prepare('SELECT id, codigo, nombre, descripcion, area, es_base, activo FROM perfil WHERE id = ? AND activo = 1 LIMIT 1');
            $stmt->execute([(int)$areaRow['perfil_base_id']]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            return $row ? $this->mapProfileRow($row) : null;
        }

        $schema = $this->getPerfilSchema($pdo);
        if (!$schema['hasArea'] || !$schema['hasEsBase']) {
            return null;
        }

        $stmt = $pdo->prepare(
            'SELECT id, codigo, nombre, descripcion, area, es_base, activo
             FROM perfil
             WHERE es_base = 1
               AND LOWER(TRIM(COALESCE(area, \'\'))) = LOWER(TRIM(COALESCE(?, \'\')))
               AND activo = 1
             ORDER BY id ASC
             LIMIT 1'
        );
        $stmt->execute([$area]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ? $this->mapProfileRow($row) : null;
    }

    private function loadBaseProfileIdsForArea(PDO $pdo, string $area): array
    {
        $areaRow = $this->loadAreaByCode($pdo, $area);
        if ($areaRow && $areaRow['perfil_base_id']) {
            return [(int)$areaRow['perfil_base_id']];
        }
        return [];
    }

    private function syncUserBaseProfileByArea(PDO $pdo, int $userId, string $area, ?string $previousArea = null): ?array
    {
        $nextBase = $this->loadBaseProfileByArea($pdo, $area);
        $idsToRemove = array_fill_keys($this->loadBaseProfileIdsForArea($pdo, $area), true);
        if ($previousArea !== null && $this->normalizeKey($previousArea) !== $this->normalizeKey($area)) {
            foreach ($this->loadBaseProfileIdsForArea($pdo, $previousArea) as $id) {
                $idsToRemove[$id] = true;
            }
        }

        if ($idsToRemove) {
            $ids = array_keys($idsToRemove);
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $stmt = $pdo->prepare("DELETE FROM usuario_perfil WHERE usuario_id = ? AND perfil_id IN ($placeholders)");
            $stmt->execute(array_merge([$userId], $ids));
        }

        if ($nextBase) {
            $stmt = $pdo->prepare(
                'INSERT INTO usuario_perfil (usuario_id, perfil_id, activo)
                 VALUES (?, ?, 1)
                 ON DUPLICATE KEY UPDATE activo = VALUES(activo)'
            );
            $stmt->execute([$userId, $nextBase['id']]);
        }

        return $nextBase;
    }

    private function loadAreas(PDO $pdo, ?int $areaId = null): array
    {
        $schema = $this->getAreaSchema($pdo);
        if (!$schema['exists']) {
            $rows = $pdo->query(
                "SELECT DISTINCT area, COUNT(*) AS total
                 FROM usuario
                 WHERE TRIM(COALESCE(area, '')) <> ''
                 GROUP BY area
                 ORDER BY area ASC"
            )->fetchAll(PDO::FETCH_ASSOC) ?: [];

            return array_map(function (array $row): array {
                $area = (string)($row['area'] ?? '');
                return [
                    'id' => null,
                    'codigo' => $this->normalizeKey($area),
                    'nombre' => $this->formatAreaLabel($area),
                    'descripcion' => '',
                    'perfil_base_id' => null,
                    'perfil_base_nombre' => '',
                    'perfil_base_codigo' => '',
                    'activo' => true,
                    'total_usuarios' => (int)($row['total'] ?? 0),
                    'total_usuarios_activos' => (int)($row['total'] ?? 0),
                    'created_at' => null,
                    'updated_at' => null,
                ];
            }, $rows);
        }

        $params = [];
        $sql = 'SELECT a.id, a.codigo, a.nombre, a.descripcion, a.perfil_base_id, p.nombre AS perfil_base_nombre, p.codigo AS perfil_base_codigo, a.activo, a.created_at, a.updated_at,
                       COUNT(DISTINCT u.id) AS total_usuarios,
                       SUM(CASE WHEN u.is_active = 1 THEN 1 ELSE 0 END) AS total_usuarios_activos
                FROM area a
                LEFT JOIN perfil p ON p.id = a.perfil_base_id
                LEFT JOIN usuario u ON LOWER(TRIM(COALESCE(u.area, \'\'))) = LOWER(TRIM(COALESCE(a.codigo, \'\')))';
        if ($areaId !== null) {
            $sql .= ' WHERE a.id = ?';
            $params[] = $areaId;
        }
        $sql .= ' GROUP BY a.id, a.codigo, a.nombre, a.descripcion, a.perfil_base_id, p.nombre, p.codigo, a.activo, a.created_at, a.updated_at ORDER BY a.nombre ASC';

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        return array_map(fn(array $row): array => $this->mapAreaRow($row), $rows);
    }

    private function loadAreaById(PDO $pdo, int $areaId): ?array
    {
        $areas = $this->loadAreas($pdo, $areaId);
        return $areas[0] ?? null;
    }

    private function loadAreaByCode(PDO $pdo, string $codigo): ?array
    {
        if (!$this->getAreaSchema($pdo)['exists']) {
            return null;
        }

        $stmt = $pdo->prepare(
            'SELECT a.id, a.codigo, a.nombre, a.descripcion, a.perfil_base_id, p.nombre AS perfil_base_nombre, p.codigo AS perfil_base_codigo, a.activo, a.created_at, a.updated_at,
                    COUNT(DISTINCT u.id) AS total_usuarios,
                    SUM(CASE WHEN u.is_active = 1 THEN 1 ELSE 0 END) AS total_usuarios_activos
             FROM area a
             LEFT JOIN perfil p ON p.id = a.perfil_base_id
             LEFT JOIN usuario u ON LOWER(TRIM(COALESCE(u.area, \'\'))) = LOWER(TRIM(COALESCE(a.codigo, \'\')))
             WHERE LOWER(TRIM(a.codigo)) = LOWER(TRIM(?))
             GROUP BY a.id, a.codigo, a.nombre, a.descripcion, a.perfil_base_id, p.nombre, p.codigo, a.activo, a.created_at, a.updated_at
             LIMIT 1'
        );
        $stmt->execute([$codigo]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ? $this->mapAreaRow($row) : null;
    }

    private function loadUsers(PDO $pdo, ?int $userId = null): array
    {
        $params = [];
        $sql = 'SELECT u.id, u.nombre, u.email, u.codigo, u.area, u.is_admin, u.is_active, u.last_login, u.fecha_creacion AS created_at FROM usuario u';
        if ($userId !== null) {
            $sql .= ' WHERE u.id = ?';
            $params[] = $userId;
        }
        $sql .= ' ORDER BY u.nombre ASC';

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $users = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        if (!$users) {
            return [];
        }

        $ids = array_map(static fn(array $user): int => (int)$user['id'], $users);
        $placeholders = implode(',', array_fill(0, count($ids), '?'));

        $stmtVendors = $pdo->prepare(
            "SELECT usuario_id, cod_vendedor, tipo
             FROM usuario_vendedor
             WHERE usuario_id IN ($placeholders)
             ORDER BY usuario_id ASC, cod_vendedor ASC"
        );
        $stmtVendors->execute($ids);
        $vendors = $stmtVendors->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $stmtMenus = $pdo->prepare(
            "SELECT um.usuario_id, m.id, m.codigo, m.nombre, m.url, m.icono, m.grupo, m.orden, m.activo, um.activo AS asignado_activo
             FROM usuario_menu um
             INNER JOIN menu m ON m.id = um.menu_id
             WHERE um.usuario_id IN ($placeholders)
             ORDER BY um.usuario_id ASC, m.orden ASC, m.nombre ASC"
        );
        $stmtMenus->execute($ids);
        $menus = $stmtMenus->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $stmtProfiles = $pdo->prepare(
            "SELECT up.usuario_id, p.id, p.codigo, p.nombre, p.descripcion, p.area, p.es_base, p.activo, up.activo AS asignado_activo
             FROM usuario_perfil up
             INNER JOIN perfil p ON p.id = up.perfil_id
             WHERE up.usuario_id IN ($placeholders)
             ORDER BY up.usuario_id ASC, p.es_base DESC, p.area ASC, p.nombre ASC"
        );
        $stmtProfiles->execute($ids);
        $profiles = $stmtProfiles->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $vendorsByUser = [];
        foreach ($vendors as $row) {
            $key = (int)$row['usuario_id'];
            $vendorsByUser[$key] ??= [];
            $vendorsByUser[$key][] = $this->mapVendorRow($row);
        }

        $menusByUser = [];
        foreach ($menus as $row) {
            $key = (int)$row['usuario_id'];
            $menusByUser[$key] ??= [];
            $menusByUser[$key][] = $this->mapMenuRow($row);
        }

        $profilesByUser = [];
        foreach ($profiles as $row) {
            $key = (int)$row['usuario_id'];
            $profilesByUser[$key] ??= [];
            $mapped = $this->mapProfileRow($row);
            $mapped['asignado_activo'] = (bool)($row['asignado_activo'] ?? 0);
            $profilesByUser[$key][] = $mapped;
        }

        return array_map(function (array $user) use ($vendorsByUser, $menusByUser, $profilesByUser): array {
            $id = (int)$user['id'];
            return $this->mapUserRow([
                ...$user,
                'vendedores' => $vendorsByUser[$id] ?? [],
                'menus' => $menusByUser[$id] ?? [],
                'perfiles' => $profilesByUser[$id] ?? [],
            ]);
        }, $users);
    }

    private function loadUser(PDO $pdo, int $userId): ?array
    {
        $users = $this->loadUsers($pdo, $userId);
        return $users[0] ?? null;
    }

    private function countActiveAdmins(PDO $pdo, ?int $excludeUserId = null): int
    {
        $sql = 'SELECT COUNT(*) AS total FROM usuario WHERE is_active = 1 AND is_admin = 1';
        $params = [];
        if ($excludeUserId !== null) {
            $sql .= ' AND id <> ?';
            $params[] = $excludeUserId;
        }
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return (int)($row['total'] ?? 0);
    }

    private function resolveMenus(PDO $pdo, mixed $rawMenus): array
    {
        $items = array_values(array_filter(array_map(function (mixed $item): array {
            if (is_array($item)) {
                if (isset($item['id']) && $item['id'] !== null) {
                    return ['type' => 'id', 'value' => $this->requireId($item['id'], 'menu_id')];
                }
                if (isset($item['codigo']) && $item['codigo'] !== null) {
                    return ['type' => 'codigo', 'value' => $this->normalizeText($item['codigo'])];
                }
            }
            $maybeId = $this->asNumber($item, null);
            if ($maybeId !== null) {
                return ['type' => 'id', 'value' => (int)$maybeId];
            }
            return ['type' => 'codigo', 'value' => $this->normalizeText($item)];
        }, $this->resolveMenuPayload($rawMenus)), static fn(array $item): bool => $item['value'] !== ''));

        if (!$items) {
            return [];
        }

        $menus = $this->loadMenus($pdo);
        $byId = [];
        $byCode = [];
        foreach ($menus as $menu) {
            $byId[(int)$menu['id']] = $menu;
            $byCode[$this->normalizeKey($menu['codigo'])] = $menu;
        }

        $resolved = [];
        $missing = [];
        $seen = [];
        foreach ($items as $item) {
            $menu = $item['type'] === 'id'
                ? ($byId[(int)$item['value']] ?? null)
                : ($byCode[$this->normalizeKey($item['value'])] ?? null);
            if (!$menu) {
                $missing[] = (string)$item['value'];
                continue;
            }
            if (!isset($seen[$menu['id']])) {
                $seen[$menu['id']] = true;
                $resolved[] = $menu;
            }
        }

        if ($missing) {
            throw new RuntimeException('Menús no encontrados: ' . implode(', ', $missing), 404);
        }

        return $resolved;
    }

    private function resolveProfiles(PDO $pdo, mixed $rawProfiles): array
    {
        $items = $this->resolveProfilePayload($rawProfiles);
        if (!$items) {
            return [];
        }

        $profiles = $this->loadProfiles($pdo);
        $byId = [];
        $byCode = [];
        foreach ($profiles as $profile) {
            $byId[(int)$profile['id']] = $profile;
            $byCode[$this->normalizeKey($profile['codigo'])] = $profile;
        }

        $resolved = [];
        $missing = [];
        $seen = [];
        foreach ($items as $item) {
            $profile = null;
            if (is_array($item) && isset($item['id'])) {
                $profile = $byId[$this->requireId($item['id'], 'perfil_id')] ?? null;
            } else {
                $maybeId = $this->asNumber($item, null);
                if ($maybeId !== null) {
                    $profile = $byId[(int)$maybeId] ?? null;
                } else {
                    $profile = $byCode[$this->normalizeKey($item)] ?? null;
                }
            }
            if (!$profile) {
                $missing[] = (string)(is_array($item) ? ($item['id'] ?? $item['codigo'] ?? '') : $item);
                continue;
            }
            if (!isset($seen[$profile['id']])) {
                $seen[$profile['id']] = true;
                $resolved[] = $profile;
            }
        }

        if ($missing) {
            throw new RuntimeException('Perfiles no encontrados: ' . implode(', ', $missing), 404);
        }

        return $resolved;
    }

    private function syncUserMenus(PDO $pdo, int $userId, array $menus): void
    {
        $stmt = $pdo->prepare('UPDATE usuario_menu SET activo = 0 WHERE usuario_id = ?');
        $stmt->execute([$userId]);
        $stmtInsert = $pdo->prepare(
            'INSERT INTO usuario_menu (usuario_id, menu_id, activo)
             VALUES (?, ?, 1)
             ON DUPLICATE KEY UPDATE activo = VALUES(activo)'
        );
        foreach ($menus as $menu) {
            $stmtInsert->execute([$userId, $menu['id']]);
        }
    }

    private function normalizeVendorType(mixed $value): ?string
    {
        $normalized = strtoupper($this->normalizeKey($value));
        if (in_array($normalized, ['P', 'PRINCIPAL'], true)) {
            return 'P';
        }
        if (in_array($normalized, ['C', 'COMPARTIDO'], true)) {
            return 'C';
        }
        if (in_array($normalized, ['S', 'SUPERVISOR'], true)) {
            return 'S';
        }
        return null;
    }

    private function buildVendorMetaPayload(array $row): array
    {
        $tipoPeriodo = $this->normalizeTipoPeriodo($row['tipo_periodo'] ?? null) ?: $this->inferTipoPeriodoFromFecha($row['fecha'] ?? null) ?: 'mensual';
        $meta = (float)($row['meta'] ?? 0);
        return [
            'id' => isset($row['id']) ? (int)$row['id'] : null,
            'usuario_id' => isset($row['usuario_id']) ? (int)$row['usuario_id'] : null,
            'usuario_nombre' => $this->normalizeText($row['usuario_nombre'] ?? ''),
            'usuario_email' => $this->normalizeText($row['usuario_email'] ?? ''),
            'usuario_area' => $this->normalizeText($row['usuario_area'] ?? ''),
            'usuario_codigo' => $this->normalizeText($row['usuario_codigo'] ?? ''),
            'fecha' => $this->formatDate($row['fecha'] ?? null),
            'tipo_periodo' => $tipoPeriodo,
            'meta_original' => $meta,
            'meta_mes' => $meta,
            'prorrateada' => false,
            'activo' => isset($row['activo']) ? (bool)$row['activo'] : true,
            'observacion' => $this->normalizeText($row['observacion'] ?? ''),
            'created_at' => $row['created_at'] ?? null,
            'updated_at' => $row['updated_at'] ?? null,
        ];
    }

    private function formatDate(mixed $value): ?string
    {
        $text = $this->normalizeText($value);
        return $text !== '' ? substr($text, 0, 10) : null;
    }

    private function inferTipoPeriodoFromFecha(mixed $fecha): string
    {
        $text = $this->normalizeText($fecha);
        if ($text === '') {
            return '';
        }
        $parts = explode('-', substr($text, 0, 10));
        if (count($parts) !== 3) {
            return '';
        }
        [, $monthPart, $dayPart] = array_map('intval', $parts);
        return ($monthPart === 1 && $dayPart === 1) ? 'anual' : 'mensual';
    }

    private function normalizeTipoPeriodo(mixed $value): string
    {
        $normalized = $this->normalizeKey($value);
        return match ($normalized) {
            'mensual', 'mes', 'm' => 'mensual',
            'anual', 'a' => 'anual',
            default => '',
        };
    }

    private function buildFechaPeriodo(string $tipoPeriodo, int $anio, int $mes): string
    {
        $tipo = $this->normalizeTipoPeriodo($tipoPeriodo) ?: 'mensual';
        $month = $tipo === 'anual' ? 1 : max(1, min(12, $mes));
        return sprintf('%04d-%02d-01', $anio, $month);
    }

    private function loadVendorMetaById(PDO $pdo, int $metaId): ?array
    {
        $stmt = $pdo->prepare(
            'SELECT vm.id, vm.usuario_id, vm.fecha, vm.tipo_periodo, vm.meta, vm.activo, vm.observacion, vm.created_at, vm.updated_at,
                    u.nombre AS usuario_nombre, u.email AS usuario_email, u.area AS usuario_area, u.codigo AS usuario_codigo
             FROM vendedor_meta vm
             LEFT JOIN usuario u ON u.id = vm.usuario_id
             WHERE vm.id = ?
             LIMIT 1'
        );
        $stmt->execute([$metaId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ? $this->buildVendorMetaPayload($row) : null;
    }

    private function listVendorMetas(PDO $pdo, array $filters = []): array
    {
        $where = [];
        $params = [];
        if (!empty($filters['usuarioId'])) {
            $where[] = 'vm.usuario_id = ?';
            $params[] = (int)$filters['usuarioId'];
        }
        if (!empty($filters['anio'])) {
            $where[] = 'YEAR(vm.fecha) = ?';
            $params[] = (int)$filters['anio'];
        }
        if (!empty($filters['tipoPeriodo'])) {
            $where[] = 'vm.tipo_periodo = ?';
            $params[] = $this->normalizeTipoPeriodo($filters['tipoPeriodo']);
        }
        if ($filters['activo'] !== null && $filters['activo'] !== '') {
            $where[] = 'vm.activo = ?';
            $params[] = $this->boolToDb($filters['activo'], 1);
        }

        $sql = 'SELECT vm.id, vm.usuario_id, vm.fecha, vm.tipo_periodo, vm.meta, vm.activo, vm.observacion, vm.created_at, vm.updated_at,
                       u.nombre AS usuario_nombre, u.email AS usuario_email, u.area AS usuario_area, u.codigo AS usuario_codigo
                FROM vendedor_meta vm
                LEFT JOIN usuario u ON u.id = vm.usuario_id';
        if ($where) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }
        $sql .= ' ORDER BY u.nombre ASC, YEAR(vm.fecha) DESC, MONTH(vm.fecha) DESC, CASE vm.tipo_periodo WHEN \'mensual\' THEN 0 WHEN \'anual\' THEN 1 ELSE 2 END ASC, vm.id DESC';

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        return array_map(fn(array $row): array => $this->buildVendorMetaPayload($row), $rows);
    }

    private function saveVendorMeta(PDO $pdo, array $data): array
    {
        $metaId = isset($data['id']) ? (int)$data['id'] : null;
        $usuarioId = $this->requireId($data['usuario_id'] ?? null, 'Usuario');
        $anio = $this->requireId($data['anio'] ?? null, 'Año');
        $tipoPeriodo = $this->normalizeTipoPeriodo($data['tipo_periodo'] ?? null);
        $mes = $this->asNumber($data['mes'] ?? null, null);
        $meta = $this->asNumber($data['meta'] ?? null, null);
        $activo = $this->asBoolean($data['activo'] ?? true, true);
        $observacion = $this->normalizeText($data['observacion'] ?? '');

        if ($tipoPeriodo === '') {
            throw new RuntimeException('Selecciona un tipo de periodo válido.', 400);
        }
        if ($meta === null || !is_finite((float)$meta) || $meta < 0) {
            throw new RuntimeException('La meta debe ser un número válido.', 400);
        }
        if ($tipoPeriodo === 'mensual' && ($mes === null || !is_finite((float)$mes) || (int)$mes < 1 || (int)$mes > 12)) {
            throw new RuntimeException('La meta mensual requiere un mes válido.', 400);
        }

        $fecha = $this->buildFechaPeriodo($tipoPeriodo, $anio, (int)($mes ?: 1));
        if ($metaId) {
            $stmt = $pdo->prepare(
                'UPDATE vendedor_meta
                 SET usuario_id = ?, fecha = ?, tipo_periodo = ?, meta = ?, activo = ?, observacion = ?, updated_at = NOW()
                 WHERE id = ?'
            );
            $stmt->execute([$usuarioId, $fecha, $tipoPeriodo, $meta, $activo ? 1 : 0, $observacion ?: null, $metaId]);
            return $this->loadVendorMetaById($pdo, $metaId) ?? [];
        }

        $stmt = $pdo->prepare(
            'INSERT INTO vendedor_meta (usuario_id, fecha, tipo_periodo, meta, activo, observacion, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
             ON DUPLICATE KEY UPDATE
               meta = VALUES(meta),
               activo = VALUES(activo),
               observacion = VALUES(observacion),
               updated_at = NOW()'
        );
        $stmt->execute([$usuarioId, $fecha, $tipoPeriodo, $meta, $activo ? 1 : 0, $observacion ?: null]);

        $saved = $this->loadVendorMetaById($pdo, (int)$pdo->lastInsertId());
        if ($saved) {
            return $saved;
        }

        $stmt = $pdo->prepare(
            'SELECT vm.id, vm.usuario_id, vm.fecha, vm.tipo_periodo, vm.meta, vm.activo, vm.observacion, vm.created_at, vm.updated_at,
                    u.nombre AS usuario_nombre, u.email AS usuario_email, u.area AS usuario_area, u.codigo AS usuario_codigo
             FROM vendedor_meta vm
             LEFT JOIN usuario u ON u.id = vm.usuario_id
             WHERE vm.usuario_id = ? AND YEAR(vm.fecha) = ? AND ((vm.tipo_periodo = ? AND MONTH(vm.fecha) = ?) OR vm.tipo_periodo = ?)
             ORDER BY CASE WHEN vm.tipo_periodo = \'mensual\' THEN 0 ELSE 1 END, vm.fecha ASC, vm.id ASC
             LIMIT 1'
        );
        $stmt->execute([
            $usuarioId,
            (int)$anio,
            $tipoPeriodo,
            (int)($mes ?: 1),
            $tipoPeriodo,
        ]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ? $this->buildVendorMetaPayload($row) : [];
    }

    public function usuarios(array $payload): array
    {
        $this->assertAdmin($payload);
        return ['ok' => true, 'data' => $this->withTransaction(fn(PDO $pdo) => $this->loadUsers($pdo))];
    }

    public function usuario(array $payload, int $userId): array
    {
        $this->assertAdmin($payload);
        $user = $this->withTransaction(fn(PDO $pdo) => $this->loadUser($pdo, $userId));
        if (!$user) {
            throw new RuntimeException('Usuario no encontrado', 404);
        }
        return ['ok' => true, 'data' => $user];
    }

    public function crearUsuario(array $payload, array $body): array
    {
        $this->assertAdmin($payload);
        $nombre = $this->normalizeText($body['nombre'] ?? '');
        $email = mb_strtolower($this->normalizeText($body['email'] ?? ''));
        $codigo = $this->cleanCode($body['codigo'] ?? '');
        $area = $this->cleanCode($body['area'] ?? '');
        $isAdmin = $this->boolToDb($body['is_admin'] ?? 0, 0);
        $isActiveInput = $this->asBoolean($body['is_active'] ?? true, true);
        $isActive = $isActiveInput === null ? 1 : ($isActiveInput ? 1 : 0);
        $password = $this->normalizeText($body['password'] ?? '');

        if (!$nombre || !$email || !$codigo || !$area) {
            throw new RuntimeException('Nombre, email, código y área son obligatorios', 400);
        }
        if (!$this->isValidEmail($email)) {
            throw new RuntimeException('Ingresa un correo válido.', 400);
        }

        $user = $this->withTransaction(function (PDO $pdo) use ($nombre, $email, $codigo, $area, $isAdmin, $isActive, $password, $body) {
            $stmt = $pdo->prepare('SELECT id FROM usuario WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) LIMIT 1');
            $stmt->execute([$email]);
            if ($stmt->fetch(PDO::FETCH_ASSOC)) {
                throw new RuntimeException('Ya existe un usuario con ese email', 409);
            }

            $stmt = $pdo->prepare('SELECT id FROM usuario WHERE TRIM(codigo) = TRIM(?) LIMIT 1');
            $stmt->execute([$codigo]);
            if ($stmt->fetch(PDO::FETCH_ASSOC)) {
                throw new RuntimeException('Ya existe un usuario con ese código', 409);
            }

            $areaRow = $this->loadAreaByCode($pdo, $area);
            if (!$areaRow) {
                throw new RuntimeException('El área seleccionada no existe.', 400);
            }

            $storedPassword = $password !== ''
                ? Security::hash_password_django($password)
                : Security::hash_password_django(bin2hex(random_bytes(16)));
            $finalActive = $password !== '' ? $isActive : 0;

            $stmt = $pdo->prepare(
                'INSERT INTO usuario (password, nombre, email, area, codigo, tema, is_active, is_admin, fecha_creacion)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())'
            );
            $stmt->execute([
                $storedPassword,
                $nombre,
                $email,
                $area,
                $codigo,
                $this->normalizeText($body['tema'] ?? '') ?: 'Claro',
                $finalActive,
                $isAdmin,
            ]);

            $newId = (int)$pdo->lastInsertId();
            $this->syncUserBaseProfileByArea($pdo, $newId, $area);
            return $this->loadUser($pdo, $newId);
        });

        return [
            'ok' => true,
            'data' => $user,
            'warning' => $password !== '' ? null : 'Usuario creado inactivo hasta definir contraseña segura',
        ];
    }

    public function actualizarUsuario(array $payload, int $userId, array $body): array
    {
        $this->assertAdmin($payload);
        $nombre = $this->normalizeText($body['nombre'] ?? '');
        $email = mb_strtolower($this->normalizeText($body['email'] ?? ''));
        $area = $this->cleanCode($body['area'] ?? '');
        $confirmed = $this->asBoolean($body['confirmar'] ?? false, false) || $this->asBoolean($body['confirmacion_fuerte'] ?? false, false);
        $isAdminInput = $body['is_admin'] ?? null;
        $isActiveInput = $body['is_active'] ?? null;

        if (!$nombre || !$email || !$area) {
            throw new RuntimeException('Nombre, email y área son obligatorios', 400);
        }
        if (!$this->isValidEmail($email)) {
            throw new RuntimeException('Ingresa un correo válido.', 400);
        }

        $user = $this->withTransaction(function (PDO $pdo) use ($payload, $userId, $nombre, $email, $area, $isAdminInput, $isActiveInput, $confirmed) {
            $current = $this->loadUser($pdo, $userId);
            if (!$current) {
                throw new RuntimeException('Usuario no encontrado', 404);
            }

            $nextIsAdmin = $isAdminInput === null ? $current['is_admin'] : (bool)$this->asBoolean($isAdminInput, $current['is_admin']);
            $nextIsActive = $isActiveInput === null ? $current['is_active'] : (bool)$this->asBoolean($isActiveInput, $current['is_active']);

            if ((int)$current['id'] === (int)($payload['id'] ?? $payload['sub'] ?? 0) && !$nextIsAdmin && !$confirmed) {
                throw new RuntimeException('No puedes quitarte permisos de administración sin confirmación', 400);
            }

            if ($current['is_admin'] && (!$nextIsAdmin || !$nextIsActive)) {
                if ($this->countActiveAdmins($pdo, $userId) < 1) {
                    throw new RuntimeException('No se puede dejar el sistema sin administradores activos', 400);
                }
            }

            $stmt = $pdo->prepare('SELECT id FROM usuario WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) AND id <> ? LIMIT 1');
            $stmt->execute([$email, $userId]);
            if ($stmt->fetch(PDO::FETCH_ASSOC)) {
                throw new RuntimeException('Ya existe un usuario registrado con este correo.', 409);
            }

            if (!$this->loadAreaByCode($pdo, $area)) {
                throw new RuntimeException('El área seleccionada no existe.', 400);
            }

            $stmt = $pdo->prepare('UPDATE usuario SET nombre = ?, email = ?, area = ?, is_admin = ?, is_active = ? WHERE id = ?');
            $stmt->execute([$nombre, $email, $area, $nextIsAdmin ? 1 : 0, $nextIsActive ? 1 : 0, $userId]);

            $this->syncUserBaseProfileByArea($pdo, $userId, $area, $current['area']);
            return $this->loadUser($pdo, $userId);
        });

        return ['ok' => true, 'data' => $user];
    }

    public function activarUsuario(array $payload, int $userId): array
    {
        $this->assertAdmin($payload);
        $user = $this->withTransaction(function (PDO $pdo) use ($userId) {
            $current = $this->loadUser($pdo, $userId);
            if (!$current) {
                throw new RuntimeException('Usuario no encontrado', 404);
            }
            $pdo->prepare('UPDATE usuario SET is_active = 1 WHERE id = ?')->execute([$userId]);
            return $this->loadUser($pdo, $userId);
        });
        return ['ok' => true, 'data' => $user];
    }

    public function desactivarUsuario(array $payload, int $userId, array $body = []): array
    {
        $this->assertAdmin($payload);
        $confirmed = $this->asBoolean($body['confirmar'] ?? false, false);
        $user = $this->withTransaction(function (PDO $pdo) use ($payload, $userId, $confirmed) {
            $current = $this->loadUser($pdo, $userId);
            if (!$current) {
                throw new RuntimeException('Usuario no encontrado', 404);
            }
            if ((int)$current['id'] === (int)($payload['id'] ?? $payload['sub'] ?? 0) && !(bool)$confirmed && $current['is_admin']) {
                throw new RuntimeException('No puedes quitarte permisos de administración sin confirmación', 400);
            }
            if ($current['is_admin'] && $this->countActiveAdmins($pdo, $userId) < 1) {
                throw new RuntimeException('No se puede dejar el sistema sin administradores activos', 400);
            }
            $pdo->prepare('UPDATE usuario SET is_active = 0 WHERE id = ?')->execute([$userId]);
            return $this->loadUser($pdo, $userId);
        });
        return ['ok' => true, 'data' => $user];
    }

    public function toggleUsuario(array $payload, int $userId): array
    {
        $this->assertAdmin($payload);
        $user = $this->withTransaction(function (PDO $pdo) use ($userId) {
            $current = $this->loadUser($pdo, $userId);
            if (!$current) {
                throw new RuntimeException('Usuario no encontrado', 404);
            }
            if ($current['is_active']) {
                if ($current['is_admin'] && $this->countActiveAdmins($pdo, $userId) < 1) {
                    throw new RuntimeException('No se puede dejar el sistema sin administradores activos', 400);
                }
                $pdo->prepare('UPDATE usuario SET is_active = 0 WHERE id = ?')->execute([$userId]);
            } else {
                $pdo->prepare('UPDATE usuario SET is_active = 1 WHERE id = ?')->execute([$userId]);
            }
            return $this->loadUser($pdo, $userId);
        });
        return ['ok' => true, 'activo' => (bool)($user['is_active'] ?? false), 'data' => $user];
    }

    public function eliminarUsuario(array $payload, int $userId, array $body = []): array
    {
        $this->assertAdmin($payload);
        $result = $this->desactivarUsuario($payload, $userId, $body);
        return [
            'ok' => true,
            'data' => $result['data'] ?? null,
            'deleted' => false,
            'mensaje' => 'Usuario desactivado lógicamente',
        ];
    }

    public function actualizarPasswordUsuario(array $payload, int $userId, array $body): array
    {
        $this->assertAdmin($payload);
        $password = $this->normalizeText($body['password'] ?? '');
        if ($password === '') {
            throw new RuntimeException('La contraseña es obligatoria', 400);
        }

        $user = $this->withTransaction(function (PDO $pdo) use ($userId, $password) {
            $current = $this->loadUser($pdo, $userId);
            if (!$current) {
                throw new RuntimeException('Usuario no encontrado', 404);
            }
            $hash = Security::hash_password_django($password);
            $pdo->prepare('UPDATE usuario SET password = ? WHERE id = ?')->execute([$hash, $userId]);
            return $this->loadUser($pdo, $userId);
        });

        return ['ok' => true, 'data' => $user];
    }

    public function menus(array $payload): array
    {
        $this->assertAdmin($payload);
        return ['ok' => true, 'data' => $this->withTransaction(fn(PDO $pdo) => $this->loadMenus($pdo))];
    }

    public function menu(array $payload, int $menuId): array
    {
        $this->assertAdmin($payload);
        $menu = $this->withTransaction(fn(PDO $pdo) => $this->loadMenuById($pdo, $menuId));
        if (!$menu) {
            throw new RuntimeException('Menú no encontrado', 404);
        }
        return ['ok' => true, 'data' => $menu];
    }

    public function crearMenu(array $payload, array $body): array
    {
        $this->assertAdmin($payload);
        $codigo = $this->cleanCode($body['codigo'] ?? '');
        $nombre = $this->normalizeText($body['nombre'] ?? '');
        $url = $this->normalizeText($body['url'] ?? '');
        $icono = $this->normalizeText($body['icono'] ?? '');
        $grupo = $this->normalizeText($body['grupo'] ?? '') ?: 'General';
        $orden = (int)($this->asNumber($body['orden'] ?? 0, 0) ?? 0);
        $activo = $this->asBoolean($body['activo'] ?? true, true);

        if ($codigo === '' || $nombre === '' || $url === '') {
            throw new RuntimeException('Código, nombre y URL son obligatorios', 400);
        }
        if (!$this->isValidMenuUrl($url)) {
            throw new RuntimeException('La URL debe comenzar con / y apuntar a un archivo index.html del módulo.', 400);
        }

        $menu = $this->withTransaction(function (PDO $pdo) use ($codigo, $nombre, $url, $icono, $grupo, $orden, $activo) {
            $stmt = $pdo->prepare('SELECT id FROM menu WHERE codigo = ? LIMIT 1');
            $stmt->execute([$codigo]);
            if ($stmt->fetch(PDO::FETCH_ASSOC)) {
                throw new RuntimeException('Ya existe un menú con este código.', 409);
            }

            $stmt = $pdo->prepare('INSERT INTO menu (codigo, nombre, url, icono, grupo, orden, activo) VALUES (?, ?, ?, ?, ?, ?, ?)');
            $stmt->execute([$codigo, $nombre, $url, $icono, $grupo, $orden, $activo ? 1 : 0]);
            return $this->loadMenuById($pdo, (int)$pdo->lastInsertId());
        });

        return ['ok' => true, 'data' => $menu];
    }

    public function actualizarMenu(array $payload, int $menuId, array $body): array
    {
        $this->assertAdmin($payload);
        $codigo = $this->cleanCode($body['codigo'] ?? '');
        $nombre = $this->normalizeText($body['nombre'] ?? '');
        $url = $this->normalizeText($body['url'] ?? '');
        $icono = $this->normalizeText($body['icono'] ?? '');
        $grupo = $this->normalizeText($body['grupo'] ?? '') ?: 'General';
        $orden = (int)($this->asNumber($body['orden'] ?? 0, 0) ?? 0);
        $activo = $this->asBoolean($body['activo'] ?? true, true);

        if ($codigo === '' || $nombre === '' || $url === '') {
            throw new RuntimeException('Código, nombre y URL son obligatorios', 400);
        }
        if (!$this->isValidMenuUrl($url)) {
            throw new RuntimeException('La URL debe comenzar con / y apuntar a un archivo index.html del módulo.', 400);
        }

        $menu = $this->withTransaction(function (PDO $pdo) use ($menuId, $codigo, $nombre, $url, $icono, $grupo, $orden, $activo) {
            $current = $this->loadMenuById($pdo, $menuId);
            if (!$current) {
                throw new RuntimeException('Menú no encontrado', 404);
            }

            $stmt = $pdo->prepare('SELECT id FROM menu WHERE codigo = ? AND id <> ? LIMIT 1');
            $stmt->execute([$codigo, $menuId]);
            if ($stmt->fetch(PDO::FETCH_ASSOC)) {
                throw new RuntimeException('Ya existe un menú con este código.', 409);
            }

            $stmt = $pdo->prepare('UPDATE menu SET codigo = ?, nombre = ?, url = ?, icono = ?, grupo = ?, orden = ?, activo = ? WHERE id = ?');
            $stmt->execute([$codigo, $nombre, $url, $icono, $grupo, $orden, $activo ? 1 : 0, $menuId]);
            return $this->loadMenuById($pdo, $menuId);
        });

        return ['ok' => true, 'data' => $menu];
    }

    public function activarMenu(array $payload, int $menuId): array
    {
        $this->assertAdmin($payload);
        $menu = $this->withTransaction(function (PDO $pdo) use ($menuId) {
            if (!$this->loadMenuById($pdo, $menuId)) {
                throw new RuntimeException('Menú no encontrado', 404);
            }
            $pdo->prepare('UPDATE menu SET activo = 1 WHERE id = ?')->execute([$menuId]);
            return $this->loadMenuById($pdo, $menuId);
        });
        return ['ok' => true, 'data' => $menu];
    }

    public function desactivarMenu(array $payload, int $menuId): array
    {
        $this->assertAdmin($payload);
        $menu = $this->withTransaction(function (PDO $pdo) use ($menuId) {
            if (!$this->loadMenuById($pdo, $menuId)) {
                throw new RuntimeException('Menú no encontrado', 404);
            }
            $pdo->prepare('UPDATE menu SET activo = 0 WHERE id = ?')->execute([$menuId]);
            return $this->loadMenuById($pdo, $menuId);
        });
        return ['ok' => true, 'data' => $menu];
    }

    public function eliminarMenu(array $payload, int $menuId): array
    {
        $this->assertAdmin($payload);
        $menu = $this->withTransaction(function (PDO $pdo) use ($menuId) {
            $current = $this->loadMenuById($pdo, $menuId);
            if (!$current) {
                throw new RuntimeException('Menú no encontrado', 404);
            }

            $stmt = $pdo->prepare('SELECT COUNT(*) AS total FROM usuario_menu WHERE menu_id = ?');
            $stmt->execute([$menuId]);
            $hasAssignments = (int)($stmt->fetch(PDO::FETCH_ASSOC)['total'] ?? 0) > 0;

            if ($hasAssignments) {
                $pdo->prepare('UPDATE menu SET activo = 0 WHERE id = ?')->execute([$menuId]);
                return [...$current, 'activo' => false, 'deleted' => false];
            }

            $pdo->prepare('DELETE FROM menu WHERE id = ?')->execute([$menuId]);
            return [...$current, 'deleted' => true];
        });

        return ['ok' => true, 'data' => $menu];
    }

    public function perfiles(array $payload): array
    {
        $this->assertAdmin($payload);
        return ['ok' => true, 'data' => $this->withTransaction(fn(PDO $pdo) => $this->loadProfiles($pdo))];
    }

    public function perfil(array $payload, int $profileId): array
    {
        $this->assertAdmin($payload);
        $perfil = $this->withTransaction(fn(PDO $pdo) => $this->loadProfileById($pdo, $profileId));
        if (!$perfil) {
            throw new RuntimeException('Perfil no encontrado', 404);
        }
        return ['ok' => true, 'data' => $perfil];
    }

    public function crearPerfil(array $payload, array $body): array
    {
        $this->assertAdmin($payload);
        $codigo = $this->cleanCode($body['codigo'] ?? '');
        $nombre = $this->normalizeText($body['nombre'] ?? '');
        $descripcion = $this->normalizeText($body['descripcion'] ?? '');
        $area = $this->normalizeText($body['area'] ?? '');
        $esBase = $this->asBoolean($body['es_base'] ?? false, false);
        $activo = $this->asBoolean($body['activo'] ?? true, true);
        if ($codigo === '' || $nombre === '') {
            throw new RuntimeException('Código y nombre son obligatorios', 400);
        }

        $perfil = $this->withTransaction(function (PDO $pdo) use ($codigo, $nombre, $descripcion, $area, $esBase, $activo) {
            $stmt = $pdo->prepare('SELECT id FROM perfil WHERE codigo = ? LIMIT 1');
            $stmt->execute([$codigo]);
            if ($stmt->fetch(PDO::FETCH_ASSOC)) {
                throw new RuntimeException('Ya existe un perfil con este código.', 409);
            }

            $stmt = $pdo->prepare('INSERT INTO perfil (codigo, nombre, descripcion, area, es_base, activo) VALUES (?, ?, ?, ?, ?, ?)');
            $stmt->execute([$codigo, $nombre, $descripcion, $area, $esBase ? 1 : 0, $activo ? 1 : 0]);
            return $this->loadProfileById($pdo, (int)$pdo->lastInsertId());
        });

        return ['ok' => true, 'data' => $perfil];
    }

    public function actualizarPerfil(array $payload, int $profileId, array $body): array
    {
        $this->assertAdmin($payload);
        $codigo = $this->cleanCode($body['codigo'] ?? '');
        $nombre = $this->normalizeText($body['nombre'] ?? '');
        $descripcion = $this->normalizeText($body['descripcion'] ?? '');
        $area = $this->normalizeText($body['area'] ?? '');
        $esBase = $this->asBoolean($body['es_base'] ?? false, false);
        $activo = $this->asBoolean($body['activo'] ?? true, true);
        if ($codigo === '' || $nombre === '') {
            throw new RuntimeException('Código y nombre son obligatorios', 400);
        }

        $perfil = $this->withTransaction(function (PDO $pdo) use ($profileId, $codigo, $nombre, $descripcion, $area, $esBase, $activo) {
            if (!$this->loadProfileById($pdo, $profileId)) {
                throw new RuntimeException('Perfil no encontrado', 404);
            }
            $stmt = $pdo->prepare('SELECT id FROM perfil WHERE codigo = ? AND id <> ? LIMIT 1');
            $stmt->execute([$codigo, $profileId]);
            if ($stmt->fetch(PDO::FETCH_ASSOC)) {
                throw new RuntimeException('Ya existe un perfil con este código.', 409);
            }

            $stmt = $pdo->prepare('UPDATE perfil SET codigo = ?, nombre = ?, descripcion = ?, area = ?, es_base = ?, activo = ? WHERE id = ?');
            $stmt->execute([$codigo, $nombre, $descripcion, $area, $esBase ? 1 : 0, $activo ? 1 : 0, $profileId]);
            return $this->loadProfileById($pdo, $profileId);
        });

        return ['ok' => true, 'data' => $perfil];
    }

    public function activarPerfil(array $payload, int $profileId): array
    {
        $this->assertAdmin($payload);
        $perfil = $this->withTransaction(function (PDO $pdo) use ($profileId) {
            if (!$this->loadProfileById($pdo, $profileId)) {
                throw new RuntimeException('Perfil no encontrado', 404);
            }
            $pdo->prepare('UPDATE perfil SET activo = 1 WHERE id = ?')->execute([$profileId]);
            return $this->loadProfileById($pdo, $profileId);
        });
        return ['ok' => true, 'data' => $perfil];
    }

    public function desactivarPerfil(array $payload, int $profileId): array
    {
        $this->assertAdmin($payload);
        $perfil = $this->withTransaction(function (PDO $pdo) use ($profileId) {
            if (!$this->loadProfileById($pdo, $profileId)) {
                throw new RuntimeException('Perfil no encontrado', 404);
            }
            $pdo->prepare('UPDATE perfil SET activo = 0 WHERE id = ?')->execute([$profileId]);
            return $this->loadProfileById($pdo, $profileId);
        });
        return ['ok' => true, 'data' => $perfil];
    }

    public function eliminarPerfil(array $payload, int $profileId): array
    {
        $this->assertAdmin($payload);
        $perfil = $this->withTransaction(function (PDO $pdo) use ($profileId) {
            $current = $this->loadProfileById($pdo, $profileId);
            if (!$current) {
                throw new RuntimeException('Perfil no encontrado', 404);
            }

            $stmt = $pdo->prepare('SELECT COUNT(*) AS total FROM perfil_menu WHERE perfil_id = ?');
            $stmt->execute([$profileId]);
            $refsMenus = (int)($stmt->fetch(PDO::FETCH_ASSOC)['total'] ?? 0);
            $stmt = $pdo->prepare('SELECT COUNT(*) AS total FROM usuario_perfil WHERE perfil_id = ?');
            $stmt->execute([$profileId]);
            $refsUsers = (int)($stmt->fetch(PDO::FETCH_ASSOC)['total'] ?? 0);

            if ($refsMenus > 0 || $refsUsers > 0) {
                $pdo->prepare('UPDATE perfil SET activo = 0 WHERE id = ?')->execute([$profileId]);
                return [...$current, 'activo' => false, 'deleted' => false];
            }

            $pdo->prepare('DELETE FROM perfil WHERE id = ?')->execute([$profileId]);
            return [...$current, 'deleted' => true];
        });
        return ['ok' => true, 'data' => $perfil];
    }

    public function perfilMenus(array $payload, int $profileId): array
    {
        $this->assertAdmin($payload);
        $perfil = $this->withTransaction(fn(PDO $pdo) => $this->loadProfileById($pdo, $profileId));
        if (!$perfil) {
            throw new RuntimeException('Perfil no encontrado', 404);
        }
        return ['ok' => true, 'data' => $perfil['menus']];
    }

    public function actualizarPerfilMenus(array $payload, int $profileId, array $body): array
    {
        $this->assertAdmin($payload);
        $perfil = $this->withTransaction(function (PDO $pdo) use ($profileId, $body) {
            if (!$this->loadProfileById($pdo, $profileId)) {
                throw new RuntimeException('Perfil no encontrado', 404);
            }

            $menus = $this->resolveMenus($pdo, $body['menus'] ?? []);
            $pdo->prepare('UPDATE perfil_menu SET activo = 0 WHERE perfil_id = ?')->execute([$profileId]);
            $stmt = $pdo->prepare(
                'INSERT INTO perfil_menu (perfil_id, menu_id, activo)
                 VALUES (?, ?, 1)
                 ON DUPLICATE KEY UPDATE activo = VALUES(activo)'
            );
            foreach ($menus as $menu) {
                $stmt->execute([$profileId, $menu['id']]);
            }

            return $this->loadProfileById($pdo, $profileId);
        });

        return ['ok' => true, 'data' => $perfil['menus'] ?? []];
    }

    public function usuarioMenus(array $payload, int $userId): array
    {
        $this->assertAdmin($payload);
        $user = $this->withTransaction(fn(PDO $pdo) => $this->loadUser($pdo, $userId));
        if (!$user) {
            throw new RuntimeException('Usuario no encontrado', 404);
        }
        return ['ok' => true, 'data' => $user['menus']];
    }

    public function usuarioPerfiles(array $payload, int $userId): array
    {
        $this->assertAdmin($payload);
        $user = $this->withTransaction(fn(PDO $pdo) => $this->loadUser($pdo, $userId));
        if (!$user) {
            throw new RuntimeException('Usuario no encontrado', 404);
        }
        return ['ok' => true, 'data' => $this->withTransaction(fn(PDO $pdo) => $this->loadUserProfiles($pdo, $userId))];
    }

    public function actualizarUsuarioPerfiles(array $payload, int $userId, array $body): array
    {
        $this->assertAdmin($payload);
        $perfiles = $this->withTransaction(function (PDO $pdo) use ($userId, $body) {
            $current = $this->loadUser($pdo, $userId);
            if (!$current) {
                throw new RuntimeException('Usuario no encontrado', 404);
            }

            $requested = $this->resolveProfiles($pdo, $body['perfiles'] ?? $body['perfil_ids'] ?? $body['profiles'] ?? []);
            $basePerfil = $this->loadBaseProfileByArea($pdo, $current['area']);
            $requestedIds = [];
            foreach ($requested as $perfil) {
                $requestedIds[(int)$perfil['id']] = true;
            }
            if ($basePerfil) {
                $requestedIds[(int)$basePerfil['id']] = true;
            }

            $pdo->prepare('UPDATE usuario_perfil SET activo = 0 WHERE usuario_id = ?')->execute([$userId]);
            $stmt = $pdo->prepare(
                'INSERT INTO usuario_perfil (usuario_id, perfil_id, activo)
                 VALUES (?, ?, 1)
                 ON DUPLICATE KEY UPDATE activo = VALUES(activo)'
            );
            foreach (array_keys($requestedIds) as $profileId) {
                $stmt->execute([$userId, $profileId]);
            }
            return $this->loadUserProfiles($pdo, $userId);
        });

        return ['ok' => true, 'data' => $perfiles];
    }

    public function agregarUsuarioPerfil(array $payload, int $userId, int $profileId): array
    {
        $this->assertAdmin($payload);
        $perfiles = $this->withTransaction(function (PDO $pdo) use ($userId, $profileId) {
            if (!$this->loadUser($pdo, $userId)) {
                throw new RuntimeException('Usuario no encontrado', 404);
            }
            if (!$this->loadProfileById($pdo, $profileId)) {
                throw new RuntimeException('Perfil no encontrado', 404);
            }
            $stmt = $pdo->prepare(
                'INSERT INTO usuario_perfil (usuario_id, perfil_id, activo)
                 VALUES (?, ?, 1)
                 ON DUPLICATE KEY UPDATE activo = VALUES(activo)'
            );
            $stmt->execute([$userId, $profileId]);
            return $this->loadUserProfiles($pdo, $userId);
        });

        return ['ok' => true, 'data' => $perfiles];
    }

    public function quitarUsuarioPerfil(array $payload, int $userId, int $profileId): array
    {
        $this->assertAdmin($payload);
        $perfiles = $this->withTransaction(function (PDO $pdo) use ($userId, $profileId) {
            $current = $this->loadUser($pdo, $userId);
            if (!$current) {
                throw new RuntimeException('Usuario no encontrado', 404);
            }
            if (!$this->loadProfileById($pdo, $profileId)) {
                throw new RuntimeException('Perfil no encontrado', 404);
            }
            $basePerfil = $this->loadBaseProfileByArea($pdo, $current['area']);
            if ($basePerfil && (int)$basePerfil['id'] === $profileId) {
                throw new RuntimeException('El perfil base del área se asigna automáticamente', 400);
            }
            $pdo->prepare('UPDATE usuario_perfil SET activo = 0 WHERE usuario_id = ? AND perfil_id = ?')->execute([$userId, $profileId]);
            return $this->loadUserProfiles($pdo, $userId);
        });

        return ['ok' => true, 'data' => $perfiles];
    }

    public function actualizarUsuarioMenus(array $payload, int $userId, array $body): array
    {
        $this->assertAdmin($payload);
        $usuario = $this->withTransaction(function (PDO $pdo) use ($payload, $userId, $body) {
            $current = $this->loadUser($pdo, $userId);
            if (!$current) {
                throw new RuntimeException('Usuario no encontrado', 404);
            }

            $confirmed = $this->asBoolean($body['confirmar'] ?? false, false) || $this->asBoolean($body['force'] ?? false, false);
            $menus = $this->resolveMenus($pdo, $body['menus'] ?? []);
            $currentId = (int)($payload['id'] ?? $payload['sub'] ?? 0);
            $keepsAdminMenu = false;
            foreach ($menus as $menu) {
                if ($this->normalizeKey($menu['codigo']) === 'administracion') {
                    $keepsAdminMenu = true;
                    break;
                }
            }
            if ($currentId === $userId && !$keepsAdminMenu && !$confirmed) {
                throw new RuntimeException('No puedes quitarte el acceso a Administración sin confirmación fuerte', 400);
            }

            $this->syncUserMenus($pdo, $userId, $menus);
            return $this->loadUser($pdo, $userId);
        });

        return ['ok' => true, 'data' => $usuario['menus'] ?? []];
    }

    public function agregarUsuarioMenu(array $payload, int $userId, int $menuId): array
    {
        $this->assertAdmin($payload);
        $usuario = $this->withTransaction(function (PDO $pdo) use ($payload, $userId, $menuId) {
            if (!$this->loadUser($pdo, $userId)) {
                throw new RuntimeException('Usuario no encontrado', 404);
            }
            if (!$this->loadMenuById($pdo, $menuId)) {
                throw new RuntimeException('Menú no encontrado', 404);
            }
            $stmt = $pdo->prepare(
                'INSERT INTO usuario_menu (usuario_id, menu_id, activo)
                 VALUES (?, ?, 1)
                 ON DUPLICATE KEY UPDATE activo = VALUES(activo)'
            );
            $stmt->execute([$userId, $menuId]);
            return $this->loadUser($pdo, $userId);
        });

        return ['ok' => true, 'data' => $usuario['menus'] ?? []];
    }

    public function quitarUsuarioMenu(array $payload, int $userId, int $menuId): array
    {
        $this->assertAdmin($payload);
        $usuario = $this->withTransaction(function (PDO $pdo) use ($payload, $userId, $menuId) {
            $current = $this->loadUser($pdo, $userId);
            if (!$current) {
                throw new RuntimeException('Usuario no encontrado', 404);
            }
            $menu = $this->loadMenuById($pdo, $menuId);
            if (!$menu) {
                throw new RuntimeException('Menú no encontrado', 404);
            }
            $currentId = (int)($payload['id'] ?? $payload['sub'] ?? 0);
            if ($currentId === $userId && $this->normalizeKey($menu['codigo']) === 'administracion') {
                throw new RuntimeException('No puedes quitarte el acceso a Administración sin confirmación fuerte', 400);
            }
            $pdo->prepare('UPDATE usuario_menu SET activo = 0 WHERE usuario_id = ? AND menu_id = ?')->execute([$userId, $menuId]);
            return $this->loadUser($pdo, $userId);
        });

        return ['ok' => true, 'data' => $usuario['menus'] ?? []];
    }

    public function vendedoresUsuario(array $payload, int $userId): array
    {
        $this->assertAdmin($payload);
        $rows = $this->withTransaction(function (PDO $pdo) use ($userId) {
            $stmt = $pdo->prepare('SELECT cod_vendedor, tipo FROM usuario_vendedor WHERE usuario_id = ? ORDER BY cod_vendedor ASC');
            $stmt->execute([$userId]);
            return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        });
        return ['ok' => true, 'data' => array_map(fn(array $row): array => $this->mapVendorRow($row), $rows)];
    }

    public function crearVendedorUsuario(array $payload, int $userId, array $body): array
    {
        $this->assertAdmin($payload);
        $codVendedor = mb_strtoupper($this->normalizeText($body['cod_vendedor'] ?? ''));
        $tipo = $this->normalizeVendorType($body['tipo'] ?? null);
        if ($codVendedor === '' || $tipo === null) {
            throw new RuntimeException('Código de vendedor y tipo son obligatorios', 400);
        }

        $rows = $this->withTransaction(function (PDO $pdo) use ($userId, $codVendedor, $tipo) {
            if (!$this->loadUser($pdo, $userId)) {
                throw new RuntimeException('Usuario no encontrado', 404);
            }
            $stmt = $pdo->prepare(
                'INSERT INTO usuario_vendedor (usuario_id, cod_vendedor, tipo)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE tipo = VALUES(tipo)'
            );
            $stmt->execute([$userId, $codVendedor, $tipo]);
            $stmt = $pdo->prepare('SELECT cod_vendedor, tipo FROM usuario_vendedor WHERE usuario_id = ? ORDER BY cod_vendedor ASC');
            $stmt->execute([$userId]);
            return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        });
        return ['ok' => true, 'data' => array_map(fn(array $row): array => $this->mapVendorRow($row), $rows)];
    }

    public function actualizarVendedorUsuario(array $payload, int $userId, string $cod, array $body): array
    {
        $this->assertAdmin($payload);
        $codVendedor = mb_strtoupper($this->normalizeText($cod));
        $tipo = $this->normalizeVendorType($body['tipo'] ?? null);
        if ($codVendedor === '' || $tipo === null) {
            throw new RuntimeException('Código de vendedor y tipo son obligatorios', 400);
        }

        $rows = $this->withTransaction(function (PDO $pdo) use ($userId, $codVendedor, $tipo) {
            $stmt = $pdo->prepare('UPDATE usuario_vendedor SET tipo = ? WHERE usuario_id = ? AND cod_vendedor = ?');
            $stmt->execute([$tipo, $userId, $codVendedor]);
            if (!$stmt->rowCount()) {
                throw new RuntimeException('Relación usuario-vendedor no encontrada', 404);
            }
            $stmt = $pdo->prepare('SELECT cod_vendedor, tipo FROM usuario_vendedor WHERE usuario_id = ? ORDER BY cod_vendedor ASC');
            $stmt->execute([$userId]);
            return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        });
        return ['ok' => true, 'data' => array_map(fn(array $row): array => $this->mapVendorRow($row), $rows)];
    }

    public function eliminarVendedorUsuario(array $payload, int $userId, string $cod): array
    {
        $this->assertAdmin($payload);
        $rows = $this->withTransaction(function (PDO $pdo) use ($userId, $cod) {
            $stmt = $pdo->prepare('DELETE FROM usuario_vendedor WHERE usuario_id = ? AND cod_vendedor = ?');
            $stmt->execute([$userId, mb_strtoupper($this->normalizeText($cod))]);
            if (!$stmt->rowCount()) {
                throw new RuntimeException('Relación usuario-vendedor no encontrada', 404);
            }
            $stmt = $pdo->prepare('SELECT cod_vendedor, tipo FROM usuario_vendedor WHERE usuario_id = ? ORDER BY cod_vendedor ASC');
            $stmt->execute([$userId]);
            return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        });
        return ['ok' => true, 'data' => array_map(fn(array $row): array => $this->mapVendorRow($row), $rows)];
    }

    public function areas(array $payload): array
    {
        $this->assertAdmin($payload);
        return ['ok' => true, 'data' => $this->withTransaction(fn(PDO $pdo) => $this->loadAreas($pdo))];
    }

    public function area(array $payload, int $areaId): array
    {
        $this->assertAdmin($payload);
        $area = $this->withTransaction(fn(PDO $pdo) => $this->loadAreaById($pdo, $areaId));
        if (!$area) {
            throw new RuntimeException('Área no encontrada', 404);
        }
        return ['ok' => true, 'data' => $area];
    }

    public function crearArea(array $payload, array $body): array
    {
        $this->assertAdmin($payload);
        $nombre = $this->normalizeText($body['nombre'] ?? '');
        $codigo = $this->cleanCode($body['codigo'] ?? $body['nombre'] ?? '');
        $descripcion = $this->normalizeText($body['descripcion'] ?? '');
        $perfilBaseId = $this->asNumber($body['perfil_base_id'] ?? null, null);
        $activo = $this->asBoolean($body['activo'] ?? true, true);
        if ($nombre === '' || $codigo === '') {
            throw new RuntimeException('Nombre y código son obligatorios', 400);
        }

        $area = $this->withTransaction(function (PDO $pdo) use ($nombre, $codigo, $descripcion, $perfilBaseId, $activo) {
            if (!$this->getAreaSchema($pdo)['exists']) {
                throw new RuntimeException('La tabla area aún no está creada. Ejecuta la migración de áreas.', 503);
            }
            $stmt = $pdo->prepare('SELECT id FROM area WHERE codigo = ? LIMIT 1');
            $stmt->execute([$codigo]);
            if ($stmt->fetch(PDO::FETCH_ASSOC)) {
                throw new RuntimeException('Ya existe un área con este código.', 409);
            }
            if ($perfilBaseId !== null && !$this->loadProfileById($pdo, (int)$perfilBaseId)) {
                throw new RuntimeException('El perfil base seleccionado no existe.', 404);
            }
            $stmt = $pdo->prepare('INSERT INTO area (codigo, nombre, descripcion, perfil_base_id, activo) VALUES (?, ?, ?, ?, ?)');
            $stmt->execute([$codigo, $nombre, $descripcion, $perfilBaseId, $activo ? 1 : 0]);
            return $this->loadAreaById($pdo, (int)$pdo->lastInsertId());
        });

        return ['ok' => true, 'data' => $area];
    }

    public function actualizarArea(array $payload, int $areaId, array $body): array
    {
        $this->assertAdmin($payload);
        $nombre = $this->normalizeText($body['nombre'] ?? '');
        $codigo = $this->cleanCode($body['codigo'] ?? $body['nombre'] ?? '');
        $descripcion = $this->normalizeText($body['descripcion'] ?? '');
        $perfilBaseId = $this->asNumber($body['perfil_base_id'] ?? null, null);
        $activo = $this->asBoolean($body['activo'] ?? true, true);
        if ($nombre === '' || $codigo === '') {
            throw new RuntimeException('Nombre y código son obligatorios', 400);
        }

        $area = $this->withTransaction(function (PDO $pdo) use ($areaId, $nombre, $codigo, $descripcion, $perfilBaseId, $activo) {
            if (!$this->loadAreaById($pdo, $areaId)) {
                throw new RuntimeException('Área no encontrada', 404);
            }
            if (!$this->getAreaSchema($pdo)['exists']) {
                throw new RuntimeException('La tabla area aún no está creada. Ejecuta la migración de áreas.', 503);
            }
            $stmt = $pdo->prepare('SELECT id FROM area WHERE codigo = ? AND id <> ? LIMIT 1');
            $stmt->execute([$codigo, $areaId]);
            if ($stmt->fetch(PDO::FETCH_ASSOC)) {
                throw new RuntimeException('Ya existe un área con este código.', 409);
            }
            if ($perfilBaseId !== null && !$this->loadProfileById($pdo, (int)$perfilBaseId)) {
                throw new RuntimeException('El perfil base seleccionado no existe.', 404);
            }
            $stmt = $pdo->prepare('UPDATE area SET codigo = ?, nombre = ?, descripcion = ?, perfil_base_id = ?, activo = ? WHERE id = ?');
            $stmt->execute([$codigo, $nombre, $descripcion, $perfilBaseId, $activo ? 1 : 0, $areaId]);
            return $this->loadAreaById($pdo, $areaId);
        });

        return ['ok' => true, 'data' => $area];
    }

    public function activarArea(array $payload, int $areaId): array
    {
        $this->assertAdmin($payload);
        $area = $this->withTransaction(function (PDO $pdo) use ($areaId) {
            if (!$this->loadAreaById($pdo, $areaId)) {
                throw new RuntimeException('Área no encontrada', 404);
            }
            $pdo->prepare('UPDATE area SET activo = 1 WHERE id = ?')->execute([$areaId]);
            return $this->loadAreaById($pdo, $areaId);
        });
        return ['ok' => true, 'data' => $area];
    }

    public function desactivarArea(array $payload, int $areaId, array $body = []): array
    {
        $this->assertAdmin($payload);
        $confirmed = $this->asBoolean($body['confirmar'] ?? false, false);
        $area = $this->withTransaction(function (PDO $pdo) use ($areaId, $confirmed) {
            $current = $this->loadAreaById($pdo, $areaId);
            if (!$current) {
                throw new RuntimeException('Área no encontrada', 404);
            }
            $stmt = $pdo->prepare(
                'SELECT COUNT(*) AS total
                 FROM usuario
                 WHERE is_active = 1 AND LOWER(TRIM(COALESCE(area, \'\'))) = LOWER(TRIM(COALESCE(?, \'\')))'
            );
            $stmt->execute([$current['codigo']]);
            $activeUsers = (int)($stmt->fetch(PDO::FETCH_ASSOC)['total'] ?? 0);
            if ($activeUsers > 0 && !$confirmed) {
                $e = new RuntimeException('No se puede desactivar un área con usuarios activos sin confirmación', 409);
                throw $e;
            }
            $pdo->prepare('UPDATE area SET activo = 0 WHERE id = ?')->execute([$areaId]);
            return $this->loadAreaById($pdo, $areaId);
        });
        return ['ok' => true, 'data' => $area];
    }

    public function aplicarPerfilArea(array $payload, int $areaId, array $body): array
    {
        $this->assertAdmin($payload);
        $result = $this->withTransaction(function (PDO $pdo) use ($areaId, $body) {
            $area = $this->loadAreaById($pdo, $areaId);
            if (!$area) {
                throw new RuntimeException('Área no encontrada', 404);
            }

            $perfilId = $this->asNumber($body['perfil_id'] ?? null, null) ?: $area['perfil_base_id'];
            if (!$perfilId) {
                throw new RuntimeException('El área no tiene perfil base asociado', 400);
            }
            $perfil = $this->loadProfileById($pdo, (int)$perfilId);
            if (!$perfil) {
                throw new RuntimeException('Perfil no encontrado', 404);
            }

            $stmt = $pdo->prepare(
                'SELECT id FROM usuario WHERE is_active = 1 AND LOWER(TRIM(COALESCE(area, \'\'))) = LOWER(TRIM(COALESCE(?, \'\')))'
            );
            $stmt->execute([$area['codigo']]);
            $users = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

            $affected = 0;
            $stmtInsert = $pdo->prepare(
                'INSERT INTO usuario_perfil (usuario_id, perfil_id, activo)
                 VALUES (?, ?, 1)
                 ON DUPLICATE KEY UPDATE activo = VALUES(activo)'
            );
            foreach ($users as $user) {
                $stmtInsert->execute([(int)$user['id'], (int)$perfil['id']]);
                $affected++;
            }

            return [
                'area' => $area,
                'perfil' => $perfil,
                'usuarios' => count($users),
                'afectados' => $affected,
            ];
        });
        return ['ok' => true, 'data' => $result];
    }

    public function asignarAccesosPorArea(array $payload, array $body): array
    {
        $this->assertAdmin($payload);
        $result = $this->withTransaction(function (PDO $pdo) use ($body) {
            $area = $this->normalizeKey($body['area'] ?? '');
            $menus = $this->resolveMenus($pdo, $body['menus'] ?? []);
            if (!$menus) {
                throw new RuntimeException('Debes indicar al menos un menú', 400);
            }

            $areaRow = $this->loadAreaByCode($pdo, $area);
            if (!$areaRow) {
                throw new RuntimeException('Área no encontrada', 404);
            }
            $perfilBaseId = (int)($areaRow['perfil_base_id'] ?? 0);
            if ($perfilBaseId <= 0) {
                throw new RuntimeException('El área no tiene perfil base asociado', 400);
            }
            $perfil = $this->loadProfileById($pdo, $perfilBaseId);
            if (!$perfil) {
                throw new RuntimeException('Perfil base del área no encontrado', 404);
            }

            $pdo->prepare('UPDATE perfil_menu SET activo = 0 WHERE perfil_id = ?')->execute([$perfilBaseId]);
            $stmt = $pdo->prepare(
                'INSERT INTO perfil_menu (perfil_id, menu_id, activo)
                 VALUES (?, ?, 1)
                 ON DUPLICATE KEY UPDATE activo = VALUES(activo)'
            );
            foreach ($menus as $menu) {
                $stmt->execute([$perfilBaseId, $menu['id']]);
            }

            $stmt = $pdo->prepare('SELECT COUNT(*) AS total FROM usuario WHERE is_active = 1 AND LOWER(TRIM(COALESCE(area, ""))) = LOWER(TRIM(COALESCE(?, "")))');
            $stmt->execute([$areaRow['codigo']]);
            $usersCount = (int)($stmt->fetch(PDO::FETCH_ASSOC)['total'] ?? 0);

            return [
                'usuarios' => $usersCount,
                'perfil' => $perfil,
                'asignaciones' => count($menus),
                'menus' => $menus,
            ];
        });

        return ['ok' => true, 'data' => $result];
    }

    public function vendedorMetas(array $payload, array $query): array
    {
        $this->assertAdmin($payload);
        return [
            'ok' => true,
            'data' => $this->withTransaction(function (PDO $pdo) use ($query) {
                return $this->listVendorMetas($pdo, [
                    'usuarioId' => $this->asNumber($query['usuario_id'] ?? null, null),
                    'anio' => $this->asNumber($query['anio'] ?? null, null),
                    'tipoPeriodo' => $this->normalizeKey($query['tipo_periodo'] ?? ($query['tipo'] ?? '')),
                    'activo' => $this->asNumber($query['activo'] ?? null, null),
                ]);
            }),
        ];
    }

    public function vendedorMeta(array $payload, int $metaId): array
    {
        $this->assertAdmin($payload);
        $meta = $this->withTransaction(fn(PDO $pdo) => $this->loadVendorMetaById($pdo, $metaId));
        if (!$meta) {
            throw new RuntimeException('Meta no encontrada', 404);
        }
        return ['ok' => true, 'data' => $meta];
    }

    public function crearVendedorMeta(array $payload, array $body): array
    {
        $this->assertAdmin($payload);
        $meta = $this->withTransaction(function (PDO $pdo) use ($body) {
            $userId = $this->requireId($body['usuario_id'] ?? null, 'Usuario');
            if (!$this->loadUser($pdo, $userId)) {
                throw new RuntimeException('El usuario seleccionado no existe.', 404);
            }
            return $this->saveVendorMeta($pdo, [
                'usuario_id' => $userId,
                'anio' => $body['anio'] ?? null,
                'mes' => $body['mes'] ?? null,
                'tipo_periodo' => $body['tipo_periodo'] ?? null,
                'meta' => $body['meta'] ?? null,
                'activo' => $body['activo'] ?? true,
                'observacion' => $body['observacion'] ?? '',
            ]);
        });
        return ['ok' => true, 'data' => $meta];
    }

    public function actualizarVendedorMeta(array $payload, int $metaId, array $body): array
    {
        $this->assertAdmin($payload);
        $meta = $this->withTransaction(function (PDO $pdo) use ($metaId, $body) {
            $userId = $this->requireId($body['usuario_id'] ?? null, 'Usuario');
            if (!$this->loadUser($pdo, $userId)) {
                throw new RuntimeException('El usuario seleccionado no existe.', 404);
            }
            if (!$this->loadVendorMetaById($pdo, $metaId)) {
                throw new RuntimeException('La meta seleccionada no existe.', 404);
            }
            return $this->saveVendorMeta($pdo, [
                'id' => $metaId,
                'usuario_id' => $userId,
                'anio' => $body['anio'] ?? null,
                'mes' => $body['mes'] ?? null,
                'tipo_periodo' => $body['tipo_periodo'] ?? null,
                'meta' => $body['meta'] ?? null,
                'activo' => $body['activo'] ?? true,
                'observacion' => $body['observacion'] ?? '',
            ]);
        });
        return ['ok' => true, 'data' => $meta];
    }

    public function activarVendedorMeta(array $payload, int $metaId): array
    {
        $this->assertAdmin($payload);
        $meta = $this->withTransaction(function (PDO $pdo) use ($metaId) {
            $current = $this->loadVendorMetaById($pdo, $metaId);
            if (!$current) {
                throw new RuntimeException('Meta no encontrada', 404);
            }
            $pdo->prepare('UPDATE vendedor_meta SET activo = 1, updated_at = NOW() WHERE id = ?')->execute([$metaId]);
            return $this->loadVendorMetaById($pdo, $metaId);
        });
        return ['ok' => true, 'data' => $meta];
    }

    public function desactivarVendedorMeta(array $payload, int $metaId): array
    {
        $this->assertAdmin($payload);
        $meta = $this->withTransaction(function (PDO $pdo) use ($metaId) {
            $current = $this->loadVendorMetaById($pdo, $metaId);
            if (!$current) {
                throw new RuntimeException('Meta no encontrada', 404);
            }
            $pdo->prepare('UPDATE vendedor_meta SET activo = 0, updated_at = NOW() WHERE id = ?')->execute([$metaId]);
            return $this->loadVendorMetaById($pdo, $metaId);
        });
        return ['ok' => true, 'data' => $meta];
    }

    public function route(array $payload, string $method, string $path, array $query, array $body): array
    {
        if ($method === 'GET' && $path === '/usuarios') return $this->usuarios($payload);
        if ($method === 'GET' && preg_match('#^/usuarios/(\d+)$#', $path, $m)) return $this->usuario($payload, (int)$m[1]);
        if ($method === 'POST' && $path === '/usuarios') return $this->crearUsuario($payload, $body);
        if ($method === 'PUT' && preg_match('#^/usuarios/(\d+)$#', $path, $m)) return $this->actualizarUsuario($payload, (int)$m[1], $body);
        if ($method === 'PATCH' && preg_match('#^/usuarios/(\d+)/activar$#', $path, $m)) return $this->activarUsuario($payload, (int)$m[1]);
        if ($method === 'PATCH' && preg_match('#^/usuarios/(\d+)/desactivar$#', $path, $m)) return $this->desactivarUsuario($payload, (int)$m[1], $body);
        if ($method === 'POST' && preg_match('#^/usuarios/(\d+)/toggle-activo$#', $path, $m)) return $this->toggleUsuario($payload, (int)$m[1]);
        if ($method === 'DELETE' && preg_match('#^/usuarios/(\d+)$#', $path, $m)) return $this->eliminarUsuario($payload, (int)$m[1], $body);
        if ($method === 'PATCH' && preg_match('#^/usuarios/(\d+)/password$#', $path, $m)) return $this->actualizarPasswordUsuario($payload, (int)$m[1], $body);

        if ($method === 'GET' && $path === '/menus') return $this->menus($payload);
        if ($method === 'GET' && preg_match('#^/menus/(\d+)$#', $path, $m)) return $this->menu($payload, (int)$m[1]);
        if ($method === 'POST' && $path === '/menus') return $this->crearMenu($payload, $body);
        if ($method === 'PUT' && preg_match('#^/menus/(\d+)$#', $path, $m)) return $this->actualizarMenu($payload, (int)$m[1], $body);
        if ($method === 'PATCH' && preg_match('#^/menus/(\d+)/activar$#', $path, $m)) return $this->activarMenu($payload, (int)$m[1]);
        if ($method === 'PATCH' && preg_match('#^/menus/(\d+)/desactivar$#', $path, $m)) return $this->desactivarMenu($payload, (int)$m[1]);
        if ($method === 'DELETE' && preg_match('#^/menus/(\d+)$#', $path, $m)) return $this->eliminarMenu($payload, (int)$m[1]);

        if ($method === 'GET' && $path === '/perfiles') return $this->perfiles($payload);
        if ($method === 'GET' && preg_match('#^/perfiles/(\d+)$#', $path, $m)) return $this->perfil($payload, (int)$m[1]);
        if ($method === 'POST' && $path === '/perfiles') return $this->crearPerfil($payload, $body);
        if ($method === 'PUT' && preg_match('#^/perfiles/(\d+)$#', $path, $m)) return $this->actualizarPerfil($payload, (int)$m[1], $body);
        if ($method === 'PATCH' && preg_match('#^/perfiles/(\d+)/activar$#', $path, $m)) return $this->activarPerfil($payload, (int)$m[1]);
        if ($method === 'PATCH' && preg_match('#^/perfiles/(\d+)/desactivar$#', $path, $m)) return $this->desactivarPerfil($payload, (int)$m[1]);
        if ($method === 'DELETE' && preg_match('#^/perfiles/(\d+)$#', $path, $m)) return $this->eliminarPerfil($payload, (int)$m[1]);
        if ($method === 'GET' && preg_match('#^/perfiles/(\d+)/menus$#', $path, $m)) return $this->perfilMenus($payload, (int)$m[1]);
        if ($method === 'PUT' && preg_match('#^/perfiles/(\d+)/menus$#', $path, $m)) return $this->actualizarPerfilMenus($payload, (int)$m[1], $body);

        if ($method === 'GET' && preg_match('#^/usuarios/(\d+)/menus$#', $path, $m)) return $this->usuarioMenus($payload, (int)$m[1]);
        if ($method === 'GET' && preg_match('#^/usuarios/(\d+)/perfiles$#', $path, $m)) return $this->usuarioPerfiles($payload, (int)$m[1]);
        if ($method === 'PUT' && preg_match('#^/usuarios/(\d+)/perfiles$#', $path, $m)) return $this->actualizarUsuarioPerfiles($payload, (int)$m[1], $body);
        if ($method === 'POST' && preg_match('#^/usuarios/(\d+)/perfiles/(\d+)$#', $path, $m)) return $this->agregarUsuarioPerfil($payload, (int)$m[1], (int)$m[2]);
        if ($method === 'DELETE' && preg_match('#^/usuarios/(\d+)/perfiles/(\d+)$#', $path, $m)) return $this->quitarUsuarioPerfil($payload, (int)$m[1], (int)$m[2]);
        if ($method === 'PUT' && preg_match('#^/usuarios/(\d+)/menus$#', $path, $m)) return $this->actualizarUsuarioMenus($payload, (int)$m[1], $body);
        if ($method === 'POST' && preg_match('#^/usuarios/(\d+)/menus/(\d+)$#', $path, $m)) return $this->agregarUsuarioMenu($payload, (int)$m[1], (int)$m[2]);
        if ($method === 'DELETE' && preg_match('#^/usuarios/(\d+)/menus/(\d+)$#', $path, $m)) return $this->quitarUsuarioMenu($payload, (int)$m[1], (int)$m[2]);
        if ($method === 'GET' && preg_match('#^/usuarios/(\d+)/vendedores$#', $path, $m)) return $this->vendedoresUsuario($payload, (int)$m[1]);
        if ($method === 'POST' && preg_match('#^/usuarios/(\d+)/vendedores$#', $path, $m)) return $this->crearVendedorUsuario($payload, (int)$m[1], $body);
        if ($method === 'PUT' && preg_match('#^/usuarios/(\d+)/vendedores/([^/]+)$#', $path, $m)) return $this->actualizarVendedorUsuario($payload, (int)$m[1], rawurldecode($m[2]), $body);
        if ($method === 'DELETE' && preg_match('#^/usuarios/(\d+)/vendedores/([^/]+)$#', $path, $m)) return $this->eliminarVendedorUsuario($payload, (int)$m[1], rawurldecode($m[2]));

        if ($method === 'GET' && $path === '/areas') return $this->areas($payload);
        if ($method === 'GET' && preg_match('#^/areas/(\d+)$#', $path, $m)) return $this->area($payload, (int)$m[1]);
        if ($method === 'POST' && $path === '/areas') return $this->crearArea($payload, $body);
        if ($method === 'PUT' && preg_match('#^/areas/(\d+)$#', $path, $m)) return $this->actualizarArea($payload, (int)$m[1], $body);
        if ($method === 'PATCH' && preg_match('#^/areas/(\d+)/activar$#', $path, $m)) return $this->activarArea($payload, (int)$m[1]);
        if ($method === 'PATCH' && preg_match('#^/areas/(\d+)/desactivar$#', $path, $m)) return $this->desactivarArea($payload, (int)$m[1], $body);
        if ($method === 'POST' && preg_match('#^/areas/(\d+)/aplicar-perfil$#', $path, $m)) return $this->aplicarPerfilArea($payload, (int)$m[1], $body);
        if ($method === 'POST' && $path === '/accesos/asignar-por-area') return $this->asignarAccesosPorArea($payload, $body);

        if ($method === 'GET' && $path === '/vendedor-metas') return $this->vendedorMetas($payload, $query);
        if ($method === 'GET' && preg_match('#^/vendedor-metas/(\d+)$#', $path, $m)) return $this->vendedorMeta($payload, (int)$m[1]);
        if ($method === 'POST' && $path === '/vendedor-metas') return $this->crearVendedorMeta($payload, $body);
        if ($method === 'PUT' && preg_match('#^/vendedor-metas/(\d+)$#', $path, $m)) return $this->actualizarVendedorMeta($payload, (int)$m[1], $body);
        if ($method === 'PATCH' && preg_match('#^/vendedor-metas/(\d+)/activar$#', $path, $m)) return $this->activarVendedorMeta($payload, (int)$m[1]);
        if ($method === 'PATCH' && preg_match('#^/vendedor-metas/(\d+)/desactivar$#', $path, $m)) return $this->desactivarVendedorMeta($payload, (int)$m[1]);

        throw new RuntimeException('Ruta de administración no encontrada', 404);
    }
}
