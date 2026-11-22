<?php
declare(strict_types=1);
require_once __DIR__.'/SharedServiceHelpers.php';

/** Transporte de lectura. No decide permisos ni escribe en ninguna conexión. */
final class ClienteActividadSoftlandService
{
    use SharedServiceHelpers;
    public function __construct(private Database $db) {}

    public function codigos(int $userId): array
    {
        // Sin fallback de administradores: exclusivamente las asociaciones del propietario.
        return $this->normalizeVendorCodes(array_column($this->vendorRelationsFromUserId($userId),'cod_vendedor'));
    }

    private function read(string $sql,array $params): array
    {
        $stmt=$this->db->softland()->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
    public static function normalizarRutBusqueda(string $rut): string
    {
        return strtoupper(str_replace(['.','-'],'',trim($rut)));
    }
    /** Campos comprobados en INFORMATION_SCHEMA y SELECT TOP de PRODIN.cwtauxi. */
    public function resolverRut(string $rut): array
    {
        $rut=self::normalizarRutBusqueda($rut);
        if(!preg_match('/^[1-9][0-9]{0,7}[0-9K]$/D',$rut))throw new RuntimeException('RUT de búsqueda inválido.',422);
        $rows=$this->read("SELECT TOP (101) LTRIM(RTRIM(CodAux)) AS codigo_auxiliar,LTRIM(RTRIM(RutAux)) AS rut,LTRIM(RTRIM(NomAux)) AS nombre,LTRIM(RTRIM(ActAux)) AS activo,LTRIM(RTRIM(Bloqueado)) AS bloqueado,LTRIM(RTRIM(ClaCli)) AS cliente FROM [PRODIN].[softland].[cwtauxi] WHERE UPPER(REPLACE(REPLACE(LTRIM(RTRIM(RutAux)),'.',''),'-',''))=? ORDER BY CodAux",[$rut]);
        if(count($rows)>100)throw new RuntimeException('Demasiadas coincidencias para este RUT. Requiere revisión de Cobranzas.',422);
        return $rows;
    }

    public function cabeceras(array $cycles,?string $only=null,?int $documentNumber=null,bool $historical=false): array
    {
        if (!$cycles) return ['cotizaciones'=>[],'notas-venta'=>[],'facturas'=>[]];
        $aux=array_values(array_unique(array_column($cycles,'codigo_auxiliar_softland')));
        if (count($aux)>100) throw new RuntimeException('Máximo 100 CodAux por lote.',422);
        $from=min(array_column($cycles,'inicio_gestion'));
        $until=(new DateTimeImmutable('tomorrow',new DateTimeZone('America/Santiago')))->format('Y-m-d');
        $in=implode(',',array_fill(0,count($aux),'?'));
        if($historical&&(count($cycles)!==1||$documentNumber===null))throw new RuntimeException('El detalle histórico requiere un ciclo y un documento específico.',422);
        $params=$historical?[...$aux,$from]:[...$aux,$from,$until];
        // Solo cabeceras. Campos NV confirmados mediante INFORMATION_SCHEMA y TOP 1.
        $definitions=[
            'cotizaciones'=>['nwcotiza','CotNum','CtFem','VenCod','CtEstado','CtSubTotal','CtTotalDesc','CtNetoAfecto','CtNetoExento','CtMonto'],
            'notas-venta'=>['nw_nventa','NVNumero','nvFem','VenCod','nvEstado','nvSubTotal','nvTotalDesc','nvNetoAfecto','nvNetoExento','nvMonto'],
            'facturas'=>['iw_gsaen','Folio','Fecha','CodVendedor','Estado','SubTotal','TotalDesc','NetoAfecto','NetoExento','Total'],
        ];
        $out=[];
        foreach ($definitions as $type=>[$table,$number,$date,$vendor,$state,$subtotal,$discount,$net,$exempt,$total]) {
            if($only!==null&&$type!==$only)continue;
            $out[$type]=$this->read("SELECT $number AS numero,CONVERT(varchar(10),$date,120) AS fecha,
                LTRIM(RTRIM(CodAux)) AS codaux,LTRIM(RTRIM($vendor)) AS vendedor,
                LTRIM(RTRIM($state)) AS estado,$subtotal AS subtotal,$discount AS descuento,
                ISNULL($net,0)+ISNULL($exempt,0) AS neto,$total AS total".
                ($type==='facturas'?',NroInt AS interno':'').
                ($only!==null?",(SELECT TOP 1 CONVERT(varchar(255),v.VenDes) FROM [PRODIN].[softland].[cwtvend] v WHERE v.VenCod=[$table].$vendor) AS vendedor_nombre":'')."
                FROM [PRODIN].[softland].[$table]
                WHERE CodAux IN ($in) AND ".($historical?"$date<?":"$date>=? AND $date<?")." AND $state<>'A'".
                ($type==='facturas'?" AND Tipo='F' AND (ISNULL($net,0)+ISNULL($exempt,0))>0":'').
                ($documentNumber!==null?" AND $number=?":'').
                " ORDER BY $date,$number",$documentNumber!==null?[...$params,$documentNumber]:$params);
        }
        return $out;
    }

    public function documentos(array $cycle,string $type,bool $global,?int $number=null,bool $historical=false): array
    {
        if (!in_array($type,['cotizaciones','notas-venta','facturas'],true)) throw new RuntimeException('Documento inválido.',422);
        if($historical&&!$global)throw new RuntimeException('Actividad histórica solo para Cobranzas.',403);
        $rows=$this->cabeceras([$cycle],$type,$number,$historical)[$type];
        $codes=$this->codigos((int)$cycle['usuario_vendedor_id']);
        $rows=array_values(array_filter($rows,static fn($row)=>($global||in_array(trim((string)$row['vendedor']),$codes,true))&&($number===null||(int)$row['numero']===$number)));
        if ($number===null) return ['ok'=>true,'documentos'=>array_slice($rows,0,200),'total'=>count($rows)];
        if (!$rows) throw new RuntimeException('Documento no encontrado.',404);
        $params=[$number];
        if ($type==='facturas') {
            // Campos ya utilizados por Analytics: precio neto derivado, sin inventar descuento.
            $sql="SELECT CodProd AS producto,CONVERT(varchar(250),DetProd) AS descripcion,CantFacturada AS cantidad,TotLinea/NULLIF(CantFacturada,0) AS precio,NULL AS descuento,TotLinea AS total FROM [PRODIN].[softland].[iw_gmovi] WHERE NroInt=? AND Tipo='F' ORDER BY CodProd";
            $params=[$rows[0]['interno']];
        } elseif ($type==='cotizaciones') {
            $sql='SELECT CodProd AS producto,CONVERT(varchar(250),DetProd) AS descripcion,CodUMed AS unidad,CtCant AS cantidad,CtPrecio AS precio,CtTotDesc AS descuento,CtTotLinea AS total FROM [PRODIN].[softland].[nwdetcot] WHERE CotNum=? ORDER BY CtLinea';
        } else {
            $sql='SELECT CodProd AS producto,CONVERT(varchar(250),DetProd) AS descripcion,nvCant AS cantidad,nvPrecio AS precio,nvTotDesc AS descuento,nvTotLinea AS total FROM [PRODIN].[softland].[nw_detnv] WHERE NVNumero=? ORDER BY nvLinea,nvCorrela';
        }
        return ['ok'=>true,'documento'=>$rows[0],'lineas'=>$this->read($sql,$params)];
    }
    /** Resumen bajo demanda: tres agregados de cabeceras por CodAux, sin tocar cache/ciclo. */
    public function resumenHistorico(array $c): array
    {
        $dates=[];$counts=[];
        foreach(['cotizacion'=>['nwcotiza','CtFem','CtEstado','cotizaciones'],'nv'=>['nw_nventa','nvFem','nvEstado','notas-venta'],'factura'=>['iw_gsaen','Fecha','Estado','facturas']] as $key=>[$table,$date,$state,$type]){
            $row=$this->read("SELECT CONVERT(varchar(10),MAX($date),120) AS ultima,COUNT(*) AS cantidad FROM [PRODIN].[softland].[$table] WHERE CodAux=? AND $date<? AND $state<>'A'".($key==='factura'?" AND Tipo='F' AND (ISNULL(NetoAfecto,0)+ISNULL(NetoExento,0))>0":''),[$c['codigo_auxiliar_softland'],$c['inicio_gestion']]);
            $dates['ultima_'.$key.'_historica_fecha']=$row[0]['ultima']??null;
            $counts[$type]=(int)($row[0]['cantidad']??0);
        }
        return ['ok'=>true,'tiene_actividad_historica'=>count(array_filter($dates))>0,'resumen'=>$dates,'cantidades'=>$counts];
    }
    /** Paginación SQL de cabeceras; nunca carga líneas de productos. */
    public function historicos(array $c,int $page=1,?string $only=null): array
    {
        if($only!==null&&!in_array($only,['cotizaciones','notas-venta','facturas'],true))throw new RuntimeException('Tipo histórico inválido.',422);
        $parts=[];$params=[];
        foreach(['cotizaciones'=>['nwcotiza','CotNum','CtFem','VenCod','CtEstado','CtMonto'],'notas-venta'=>['nw_nventa','NVNumero','nvFem','VenCod','nvEstado','nvMonto'],'facturas'=>['iw_gsaen','Folio','Fecha','CodVendedor','Estado','Total']] as $type=>[$table,$number,$date,$vendor,$state,$amount]){
            if($only!==null&&$type!==$only)continue;
            $parts[]="SELECT '$type' AS tipo,CONVERT(varchar(50),$number) AS numero,$number AS orden_numero,CONVERT(varchar(10),$date,120) AS fecha,LTRIM(RTRIM($vendor)) AS vendedor,(SELECT TOP 1 CONVERT(varchar(255),v.VenDes) FROM [PRODIN].[softland].[cwtvend] v WHERE v.VenCod=[$table].$vendor) AS vendedor_nombre,LTRIM(RTRIM($state)) AS estado,$amount AS total FROM [PRODIN].[softland].[$table] WHERE CodAux=? AND $date<? AND $state<>'A'".($type==='facturas'?" AND Tipo='F' AND (ISNULL(NetoAfecto,0)+ISNULL(NetoExento,0))>0":'');
            $params[]=$c['codigo_auxiliar_softland'];$params[]=$c['inicio_gestion'];
        }
        $page=max(1,min($page,10000));$rows=$this->read('SELECT * FROM ('.implode(' UNION ALL ',$parts).') historico ORDER BY fecha DESC,orden_numero DESC,tipo OFFSET '.(($page-1)*50).' ROWS FETCH NEXT 51 ROWS ONLY',$params);
        return ['ok'=>true,'documentos'=>array_slice($rows,0,50),'pagina'=>$page,'hay_mas'=>count($rows)>50];
    }
}
