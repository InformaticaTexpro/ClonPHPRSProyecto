<?php
declare(strict_types=1);

require_once __DIR__ . '/ConcursoCierreStore.php';

/** Proyecciones del concurso: no recalcula cierres ni accede a información comercial externa. */
final class ConcursoHistorialRankingService
{
    // Solo visibilidad del ranking público: identidades verificadas en el cierre oficial local.
    private const RANKING_PUBLICO_OCULTOS = [42, 4]; // TEXPRO; BARBARA PERRET.
    public function __construct(private ?Closure $loader = null, private ?Closure $clock = null) {}

    public function hoy(): DateTimeImmutable
    {
        return $this->clock ? ($this->clock)() : new DateTimeImmutable('today');
    }

    private function cargar(int $mes): ?array
    {
        return $this->loader ? ($this->loader)($mes) : (new ConcursoCierreStore())->load($mes);
    }

    public function esFuturo(int $anio, int $mes): bool
    {
        return sprintf('%04d-%02d',$anio,$mes) > $this->hoy()->format('Y-m');
    }

    public function historial(int $usuarioId, callable $puntajeVigente): array
    {
        $today = $this->hoy();
        $history = [];
        foreach ([10=>'Octubre',11=>'Noviembre',12=>'Diciembre'] as $month=>$name) {
            $closed = $this->cargar($month);
            $isClosed = ($closed['estado']??null) === 'CERRADO';
            $future = $this->esFuturo(2026,$month);
            $current = $today->format('Y-m') === sprintf('2026-%02d',$month);
            $points = null;
            if ($isClosed) {
                foreach ($closed['snapshot']['vendedores'] as $vendor) if ($vendor['usuarioId'] === $usuarioId) $points = $vendor['totalMes'];
            } elseif ($future) $points = 0;
            elseif ($current) $points = $puntajeVigente($month)['puntosMes'] ?? null;
            $history[] = ['mes'=>$month,'nombreMes'=>$name,'puntos'=>$points,'estado'=>$isClosed?'CERRADO':($future?'PRÓXIMO':'EN CURSO'),
                'cerrado'=>$isClosed,'clickeable'=>$isClosed,'actual'=>$current];
        }
        return $history;
    }

    public function ranking(array $query): array
    {
        if (array_diff(array_keys($query),['anio','mes'])) throw new RuntimeException('El ranking solo admite año y mes.',400);
        if (!in_array($query['anio']??null,[2026,'2026'],true)
            || !in_array($query['mes']??null,[10,'10',11,'11',12,'12'],true)) throw new RuntimeException('Seleccione Octubre, Noviembre o Diciembre de 2026.',400);
        $month = (int)$query['mes'];
        $closed = $this->cargar($month);
        if (($closed['estado']??null) !== 'CERRADO') throw new RuntimeException('El ranking oficial estará disponible cuando el mes sea cerrado.',409);
        $groups = ['A'=>[],'B'=>[],'C'=>[],'SIN META'=>[]];
        $seen = [];
        foreach ($closed['snapshot']['vendedores'] as $vendor) {
            $type = $vendor['tipo'];
            if (!array_key_exists($type,$groups) || isset($seen[$vendor['usuarioId']])) throw new RuntimeException('Integridad del ranking oficial inválida.',409);
            $seen[$vendor['usuarioId']] = true;
            if (in_array($vendor['usuarioId'],self::RANKING_PUBLICO_OCULTOS,true)) continue;
            // Lista blanca: ningún importe, cliente, documento ni desglose sale al navegador.
            $groups[$type][] = ['vendedor'=>$vendor['vendedor'],'tramo'=>$type,'totalMes'=>$vendor['totalMes']];
        }
        $result = [];
        foreach ($groups as $type=>$vendors) {
            usort($vendors,static fn($a,$b) => ($b['totalMes'] <=> $a['totalMes']) ?: strcmp($a['vendedor'],$b['vendedor']));
            if ($type !== 'SIN META' || $vendors) $result[] = ['tramo'=>$type,'vendedores'=>$vendors];
        }
        return ['ok'=>true,'anio'=>2026,'mes'=>$month,'estado'=>'CERRADO','version'=>$closed['version'],
            'cantidadVendedores'=>array_sum(array_map('count',$groups)),'sinMeta'=>count($groups['SIN META']),'tramos'=>$result];
    }
}
