<?php
declare(strict_types=1);

function pdf_text(string $value): string
{
    $text = @iconv('UTF-8', 'Windows-1252//TRANSLIT', $value);
    if ($text === false || $text === '') {
        $text = $value;
    }
    $text = str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], $text);
    return $text;
}

function build_simple_pdf(array $lines, string $title = 'RSProyecto'): string
{
    $safeLines = array_values(array_map(static fn($line) => pdf_text((string)$line), $lines));
    $content = "BT\n/F1 12 Tf\n50 800 Td\n";
    $first = true;
    foreach ($safeLines as $line) {
        if (!$first) {
            $content .= "T*\n";
        }
        $content .= '(' . $line . ") Tj\n";
        $first = false;
    }
    $content .= "ET\n";

    $objects = [];
    $objects[] = "<< /Type /Catalog /Pages 2 0 R >>";
    $objects[] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
    $objects[] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>";
    $objects[] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
    $objects[] = "<< /Length " . strlen($content) . " >>\nstream\n" . $content . "endstream";

    $pdf = "%PDF-1.4\n";
    $offsets = [0];
    foreach ($objects as $index => $object) {
        $offsets[] = strlen($pdf);
        $pdf .= ($index + 1) . " 0 obj\n" . $object . "\nendobj\n";
    }
    $xrefPos = strlen($pdf);
    $pdf .= "xref\n0 " . (count($objects) + 1) . "\n";
    $pdf .= "0000000000 65535 f \n";
    foreach (array_slice($offsets, 1) as $offset) {
        $pdf .= sprintf('%010d 00000 n ', $offset) . "\n";
    }
    $pdf .= "trailer\n<< /Size " . (count($objects) + 1) . " /Root 1 0 R /Info << /Title (" . pdf_text($title) . ") >> >>\n";
    $pdf .= "startxref\n" . $xrefPos . "\n%%EOF";

    return $pdf;
}
