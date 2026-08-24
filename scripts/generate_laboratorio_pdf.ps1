param(
    [Parameter(Mandatory = $true)]
    [string]$TemplatePath,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [Parameter(Mandatory = $true)]
    [string]$PayloadPath
)

$ErrorActionPreference = 'Stop'

$payloadRaw = Get-Content -LiteralPath $PayloadPath -Raw -Encoding UTF8
$payload = $payloadRaw | ConvertFrom-Json
$data = $payload

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
    $wb = $excel.Workbooks.Open($TemplatePath)

    while ($wb.Worksheets.Count -gt 1) {
        $wb.Worksheets.Item(2).Delete()
    }

    $ws1 = $wb.Worksheets.Item(1)
    $ws1.Name = 'Hoja1'

    $ws1.Copy([Type]::Missing, $ws1)
    $ws2 = $wb.Worksheets.Item(2)
    $ws1.Copy([Type]::Missing, $ws2)
    $ws3 = $wb.Worksheets.Item(3)

    $sheets = @($ws1, $ws2, $ws3)
    $paramNames = @()
    if ($null -ne $data.parametros) {
        foreach ($item in @($data.parametros)) {
            $name = [string]$item.parametro_nombre
            if ($name.Trim()) {
                $paramNames += $name.Trim()
            }
        }
    }

    # La plantilla trae un catalogo fijo en estas celdas; las reutilizamos para
    # mostrar solo los parametros de la solicitud actual.
    $slots = @(
        'F28', 'F30', 'F32', 'F34', 'F36', 'F38',
        'V28', 'V30', 'V32', 'V34', 'V36', 'V38'
    )
    $legacySlots = @('N28', 'N30', 'N32', 'N34', 'N36', 'N38')

    foreach ($ws in $sheets) {
        $ws.Range('Y5').Value2 = [string]$data.numero_solicitud
        $ws.Range('J5').Value2 = [string]$data.fecha_formato
        $ws.Range('V6').Value2 = [string]$data.vendedor_nombre
        $ws.Range('V7').Value2 = 'NO'
        $ws.Range('V8').Value2 = [string]$data.vendedor_codigo
        $ws.Range('N6').Value2 = 'CANTIDAD : ' + [string]$data.numero_muestras
        $ws.Range('N7').Value2 = if ([string]$data.estado) { 'LOTE : ' + [string]$data.estado } else { 'LOTE : -' }
        $ws.Range('B42').Value2 = [string]$data.observacion

        foreach ($slot in ($slots + $legacySlots)) {
            $ws.Range($slot).Value2 = ''
        }

        for ($i = 0; $i -lt [Math]::Min($paramNames.Count, $slots.Count); $i++) {
            $ws.Range($slots[$i]).Value2 = '[x] ' + $paramNames[$i]
        }

        $ws.PageSetup.PrintArea = "`$A`$1:`$AB`$47"
        $ws.PageSetup.Zoom = $false
        $ws.PageSetup.FitToPagesWide = 1
        $ws.PageSetup.FitToPagesTall = 1
        $ws.PageSetup.CenterHorizontally = $true
    }

    $wb.ExportAsFixedFormat(0, $OutputPath)
    $wb.Close($false)
} finally {
    $excel.Quit()
}
