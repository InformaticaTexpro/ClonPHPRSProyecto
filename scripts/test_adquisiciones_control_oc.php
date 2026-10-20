<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/api/src/Env.php';
require_once dirname(__DIR__) . '/api/src/Database.php';
require_once dirname(__DIR__) . '/api/src/SharedServiceHelpers.php';
require_once dirname(__DIR__) . '/api/src/AdquisicionesService.php';
date_default_timezone_set('America/Santiago');

// Ejecuta la base SQL del servicio sobre fixtures locales. Solo se traduce sintaxis T-SQL.
final class OcTestPDO extends PDO
{
    public int $queries = 0;
    public function __construct()
    {
        parent::__construct('sqlite::memory:');
        $this->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->sqliteCreateFunction('GETDATE', static fn(): string => '2026-10-20');
        $this->sqliteCreateFunction('DATEDIFF', static fn(string $unit, ?string $start, ?string $end): ?int => $start === null || $end === null ? null : (int)((strtotime($end) - strtotime($start)) / 86400));
        $this->sqliteCreateFunction('DATEADD', static fn(string $unit, int $days, string $date): string => date('Y-m-d', strtotime($date . ' +' . $days . ' days')));
    }
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $this->queries++;
        $query = str_replace(['[PRODIN].INFORMATION_SCHEMA.COLUMNS', '[PRODIN].[softland].', ' COLLATE DATABASE_DEFAULT', 'COUNT_BIG(', ' + \'-01\''], ['_oc_columns', '', '', 'COUNT(', ' || \'-01\''], $query);
        $query = preg_replace('/CONVERT\(date,\s*GETDATE\(\)\)/i', 'DATE(GETDATE())', $query);
        $query = preg_replace('/CONVERT\(date,\s*([\w.]+)\)/i', 'DATE($1)', $query);
        $query = preg_replace('/CONVERT\(varchar\(10\),\s*([\w.]+),\s*23\)/i', "strftime('%Y-%m-%d',$1)", $query);
        $query = preg_replace('/CONVERT\(char\(7\),\s*([\w.]+),\s*23\)/i', "strftime('%Y-%m',$1)", $query);
        $query = preg_replace('/\b(DATEDIFF|DATEADD)\(DAY,/', "$1('DAY',", $query);
        $query = preg_replace('/OFFSET CAST\(\? AS int\) ROWS FETCH NEXT CAST\(\? AS int\) ROWS ONLY/i', 'LIMIT CAST(? AS int), CAST(? AS int)', $query);
        if (str_contains($query, 'GROUP BY GROUPING SETS')) {
            [$with, $select] = explode(' SELECT CASE WHEN GROUPING', $query, 2);
            [$body] = explode(' GROUP BY GROUPING SETS', 'SELECT CASE WHEN GROUPING' . $select, 2);
            $sets = [['codEstado', 'estadoRecepcion'], ['periodo'], ['codAux', 'proveedor'], ['codiCC', 'centroCosto'], ['segmentoAntiguedad']];
            $selects = [];
            foreach ($sets as $set) {
                $part = preg_replace_callback('/GROUPING\((\w+)\)/', static fn(array $m): string => in_array($m[1], $set, true) ? '0' : '1', $body);
                $selects[] = $part . ' GROUP BY ' . implode(',', $set);
            }
            $query = $with . ' ' . implode(' UNION ALL ', $selects);
        }
        return parent::prepare($query, $options);
    }
}

$checks = 0;
$check = static function (bool $condition, string $name) use (&$checks): void {
    $checks++;
    if (!$condition) throw new RuntimeException('Falló: ' . $name);
};
$near = static fn(float $a, float $b, float $epsilon = .00001): bool => abs($a - $b) <= $epsilon;
$pool = new OcTestPDO();
$tables = [
    'OWOrdenCom' => 'NumInterOC INTEGER PRIMARY KEY,NumOC INTEGER,FechaOC TEXT,CodEstado TEXT,CodAux TEXT,CodiCC TEXT,CodMon TEXT,EquivMonOC REAL,ValorTotOC REAL,ValorTotMB REAL',
    'OWOrdenDet' => 'NumInterOC INTEGER,NumLinea INTEGER,CodProd TEXT,DetProd TEXT,FechaEnt TEXT,Cantidad REAL,RecepManual REAL,ValorTotal REAL,ValorTotalMB REAL,Recibido REAL DEFAULT 99999,Saldo REAL DEFAULT 99999',
    'iw_gsaen' => 'Orden INTEGER,Tipo TEXT,NroInt INTEGER,Estado TEXT,Concepto TEXT',
    'iw_gmovi' => 'Tipo TEXT,NroInt INTEGER,OcCorrela INTEGER,CodProd TEXT,CantIngresada REAL,CantDespachada REAL',
    'OWGuiaRec' => 'NumInterG INTEGER,Estado TEXT', 'OWGuiaDet' => 'NumInterG INTEGER,NumInterOC INTEGER,NumLinea INTEGER,CodProd TEXT,Cantidad REAL',
    'CWTAuxi' => 'CodAux TEXT,NomAux TEXT', 'CWTCCOS' => 'CodiCC TEXT,DescCC TEXT', 'CWTMone' => 'CodMon TEXT,SimMon TEXT',
];
$pool->exec('CREATE TABLE _oc_columns (TABLE_SCHEMA TEXT,TABLE_NAME TEXT,COLUMN_NAME TEXT)');
foreach ($tables as $name => $columns) {
    $pool->exec("CREATE TABLE $name ($columns)");
    foreach ($pool->query("PRAGMA table_info($name)") as $column) {
        $stmt = $pool->prepare('INSERT INTO _oc_columns VALUES (?,?,?)'); $stmt->execute(['softland', $name, $column['name']]);
    }
}
$pool->exec("INSERT INTO CWTAuxi VALUES ('P1','Proveedor uno'),('P2','Proveedor dos')");
$pool->exec("INSERT INTO CWTCCOS VALUES ('CC1','Laboratorio'),('CC2','Planta')");
$pool->exec("INSERT INTO CWTMone VALUES ('01','$'),('02','US$')");
$header = $pool->prepare('INSERT INTO OWOrdenCom VALUES (?,?,?,?,?,?,?,?,?,?)');
foreach (range(1, 12) as $id) $header->execute([$id, [1 => 99103192, 2 => 99103191, 3 => 99103190, 4 => 99103182, 5 => 99103176][$id] ?? (99100000 + $id),
    '2026-10-01', match ($id) { 8 => 'PE', 9 => 'UN', 12 => 'ZZ', default => 'AP' }, $id === 6 ? 'P2' : 'P1', $id === 6 ? 'CC2' : 'CC1', $id === 4 ? '02' : '01', $id === 4 ? 978.6 : 1, $id === 4 ? 1613.92 : 100, $id === 4 ? 1613.92 : 100]);
foreach (range(20, 124) as $id) $header->execute([$id, 99000000 + $id, '2026-01-03', 'PE', 'P1', 'CC1', '01', 1, 10, 10]);
$line = $pool->prepare('INSERT INTO OWOrdenDet (NumInterOC,NumLinea,CodProd,DetProd,FechaEnt,Cantidad,RecepManual,ValorTotal,ValorTotalMB) VALUES (?,?,?,?,?,?,?,?,?)');
foreach ([
    [1,1,'A','Sobrerrecepción','2026-09-01',10,0,100,100], [2,1,'A','Recepción mixta','2026-09-01',10,2,100,100],
    [3,1,'A','Sobre no inventariable','2026-09-01',2,0,100,100], [4,1,'A','Recepción parcial USD','2026-10-15',917,0,1613.92,1613.92],
    [6,1,'A','Próxima entrega','2026-10-23',10,0,1000,1000], [8,1,'A','No aprobada','2026-09-01',10,0,100,100],
    [9,1,'A','Nula','2026-09-01',10,0,100,100], [10,1,'A','Sin fecha',null,10,0,200,200],
    [11,1,'A','Tolerancia','2026-09-01',1,.99995,100,100],
] as $values) $line->execute($values);
foreach (range(1,4) as $i) $line->execute([5,$i,'A','Completa','2026-10-10',1,1,25,25]);
$pool->exec("INSERT INTO iw_gsaen VALUES (99103192,'E',1,'V','01'),(99103191,'E',2,'V','02'),(99103182,'E',4,'V','01'),(99103182,'S',5,'V','05'),(99103191,'E',6,'N','01'),(99103191,'E',7,'V','03')");
$pool->exec("INSERT INTO iw_gmovi VALUES ('E',1,1,'A',15.5,0),('E',2,1,'A',5,0),('E',4,1,'A',909,0),('S',5,1,'A',0,1),('E',6,1,'A',999,0),('E',7,1,'A',999,0),('E',2,1,'OTRO',999,0),('E',2,99,'A',999,0)");
$pool->exec("INSERT INTO OWGuiaRec VALUES (1,'V'),(2,'N'),(3,'V')");
$pool->exec("INSERT INTO OWGuiaDet VALUES (1,2,1,'A',3),(2,2,1,'A',999),(3,3,1,'A',3)");
$db = new Database();
(new ReflectionProperty(Database::class, 'softland'))->setValue($db, $pool);
$service = new AdquisicionesService($db);
$admin = ['sub' => 1, 'is_admin' => true];
$query = ['desde' => '2026-01-01', 'hasta' => '2026-10-20', 'incluirOpciones' => '1'];
$get = static fn(string $path, array $q = []): array => $service->route($admin, 'GET', '/control-oc' . $path, $q ?: $query);
$reject = static function (callable $fn, int $code) use ($check): void { try { $fn(); $check(false, 'Debe rechazar'); } catch (RuntimeException $e) { $check($e->getCode() === $code, 'Código HTTP ' . $code); } };
$reject(fn() => $get('', ['desde' => '2026-10-20', 'hasta' => '2026-01-01']), 400);
$reject(fn() => $get('', ['desde' => '2026-02-30']), 400);
$reject(fn() => $service->route(['sub' => 1], 'GET', '/control-oc', []), 403);
$reject(fn() => $service->route($admin, 'POST', '/control-oc', []), 405);
$reject(fn() => $get('/lineas', ['numInterOC' => 'x']), 400);
$beforeQueries = $pool->queries;
$started = microtime(true); $summary = $get(''); $elapsed = (microtime(true) - $started) * 1000;
$check($pool->queries - $beforeQueries <= 3, 'Resumen batch: metadatos + agregados + opciones, sin N+1');
$check($summary['ok'] && $summary['kpis']['emitidas']['cantidad'] === 117, 'Resumen anual agregado');
$check(!isset($summary['ordenes']), 'No precargar OC');
foreach ($summary['conciliaciones'] as $key => $value) $check($value === true, 'Conciliación ' . $key);
$check($summary['kpis']['otrosEstados']['cantidad'] === 1, 'Estado desconocido explícito');
$check($summary['recepcion']['SD']['cantidad'] === 1, 'Sin detalle');
$check($summary['finanzas']['montoVencidoNetoMB'] <= $summary['finanzas']['montoPendienteNetoMB'], 'Vencido <= pendiente');
$check(count($summary['opciones']['proveedores']) === 2, 'Opciones presentes en rango');
$detail = $get('/detalle'); $second = $get('/detalle', $query + ['pagina' => '2']);
$check(count($detail['ordenes']) === 100 && $detail['hayMas'], 'Primera página');
$check(count($second['ordenes']) === 17 && !$second['hayMas'], 'Segunda página');
$partial = $get('/lineas', ['numInterOC' => '4']);
$check($partial['cabecera']['estadoRecepcion'] === 'RP', 'Caso RP');
$check($near($partial['lineas'][0]['recibidoReal'],908) && $near($partial['lineas'][0]['saldoReal'],9), 'Entradas menos devoluciones');
$check($partial['lineas'][0]['diasAtraso'] === 5, 'Atraso por FechaEnt');
$check($near($partial['lineas'][0]['montoPendienteMonedaOC'],15.84), 'Pendiente USD');
$check($near($partial['lineas'][0]['montoPendienteNetoMB'],15501.024), 'Pendiente MB corregido');
$check($partial['cabecera']['cabeceraMBRecalculada'] && $partial['lineas'][0]['lineaMBRecalculada'], 'Corrección cabecera/línea');
$over = $get('/lineas', ['numInterOC' => '1']);
$check($over['cabecera']['estadoRecepcion'] === 'RC' && $over['lineas'][0]['tieneSobreRecepcion'], 'RC con sobrerrecepción');
$check($near($over['lineas'][0]['saldoReal'],-5.5) && $over['lineas'][0]['estadoLinea'] === 'COMPLETA', 'Negativo completo');
$mixed = $get('/lineas', ['numInterOC' => '2']);
$check($mixed['cabecera']['estadoRecepcion'] === 'RC' && $near($mixed['lineas'][0]['recibidoReal'],10), 'Manual + E + guía V; ignora guías N/producto/línea incorrectos');
$check(count($get('/lineas', ['numInterOC' => '5'])['lineas']) === 4, 'Cuatro líneas completas');
$check($get('/lineas', ['numInterOC' => '3'])['cabecera']['estadoRecepcion'] === 'RC', 'Segundo caso RC con sobre');
$check($near($get('/lineas', ['numInterOC' => '11'])['lineas'][0]['saldoReal'],0), 'Tolerancia');
$alert = $get('/alerta', $query + ['tipo' => 'vencidas']);
$check($alert['cantidad'] === $summary['alertas']['vencidas']['cantidad'], 'Alerta concilia cantidad');
$check($near($alert['montoVencidoNetoMB'],$summary['finanzas']['montoVencidoNetoMB']), 'Alerta concilia monto');
$check($get('/alerta', $query + ['tipo' => 'sobrerrecepcion'])['cantidad'] === 2, 'Alerta de sobre');
$check($get('/alerta', $query + ['tipo' => 'sin_fecha'])['cantidad'] === 1, 'Alerta sin fecha');
$check($get('', $query + ['estadoRecepcion' => 'RP'])['kpis']['emitidas']['cantidad'] === 1, 'Filtro recepción');
$check($get('', $query + ['proveedor' => 'P2'])['kpis']['emitidas']['cantidad'] === 1, 'Filtro proveedor');
$empty = $get('', $query + ['proveedor' => 'INEXISTENTE']);
$check($empty['kpis']['emitidas']['cantidad'] === 0 && !in_array(false, $empty['conciliaciones'], true), 'Resumen vacío válido');
$check($service->route(['sub' => 2, 'menus' => [['codigo' => 'adquisiciones_control_oc']]], 'GET', '/control-oc', $query)['ok'], 'Acceso por permiso de menú');
$expr = new ReflectionMethod(AdquisicionesService::class, 'mbSql');
foreach ([[100,995,'02',10,995],[100,990,'02',10,990],[100,980,'02',10,1000],[100,999,'01',10,999],[100,123,'02',0,123],[0,123,'02',10,123]] as [$value,$stored,$currency,$rate,$expected]) {
    $sql = $expr->invoke($service, (string)$value, (string)$stored, "'$currency'", (string)$rate);
    $check($near((float)$pool->query('SELECT ' . $sql)->fetchColumn(),$expected), 'Regla moneda ' . implode('/',[$value,$stored,$currency,$rate]));
}
printf("OK: %d comprobaciones SQL locales. Resumen anual (fixtures): %.1f ms\n", $checks, $elapsed);

// Integración opcional: únicamente SELECT, sin bootstrap ni escritura del catálogo MySQL.
$envPath = dirname(__DIR__) . '/.env';
if (is_file($envPath)) load_env_file($envPath);
try { $liveDb = new Database(); $liveDb->softland(); }
catch (Throwable) { echo "Integración Softland omitida: conexión local no disponible.\n"; exit(0); }
$live = new AdquisicionesService($liveDb);
$started = microtime(true);
$real = $live->route($admin, 'GET', '/control-oc', ['desde' => date('Y-01-01'), 'hasta' => date('Y-m-d')]);
printf("Resumen anual Softland: %.1f ms; OC: %d; abiertas: %d; vencidas: %d\n", (microtime(true)-$started)*1000, $real['kpis']['emitidas']['cantidad'], $real['recepcion']['abiertas']['cantidad'], $real['alertas']['vencidas']['cantidad']);
$live->route($admin, 'GET', '/control-oc/detalle', ['desde' => date('Y-01-01'), 'hasta' => date('Y-m-d')]);
$stmt = $liveDb->softland()->prepare("SELECT NumInterOC, NumOC FROM [PRODIN].[softland].[OWOrdenCom]
    WHERE NumOC IN (?,?,?,?,?) AND FechaOC >= ? AND FechaOC < ?");
$stmt->execute([99103192,99103191,99103190,99103182,99103176,date('Y-01-01'),date('Y-m-d',strtotime('+1 day'))]);
foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $reference) {
    $case = $live->route($admin, 'GET', '/control-oc/lineas', ['numInterOC' => (string)$reference['NumInterOC']]);
    printf("OC real %s: %s; líneas %d; pendiente neto MB %.4f; atraso actual %d días\n", $reference['NumOC'], $case['cabecera']['estadoRecepcion'], count($case['lineas']), $case['cabecera']['montoPendienteNetoMB'], $case['cabecera']['maxDiasAtraso']);
    $check($near(array_sum(array_column($case['lineas'],'montoPendienteNetoMB')), $case['cabecera']['montoPendienteNetoMB'], .05), 'Líneas reales concilian cabecera ' . $reference['NumOC']);
}
echo "Integración de resumen/detalle y conciliaciones: OK. Valores reales no se hardcodean.\n";
