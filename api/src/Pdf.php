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

function build_paginated_pdf(array $lines, string $title = 'RSProyecto', int $linesPerPage = 38): string
{
    $safeLines = array_values(array_map(static fn($line) => pdf_text((string)$line), $lines));
    $linesPerPage = max(1, $linesPerPage);
    $pages = array_chunk($safeLines, $linesPerPage);
    if (!$pages) {
        $pages = [[]];
    }

    $objects = [
        1 => '<< /Type /Catalog /Pages 2 0 R >>',
        2 => '<< /Type /Pages /Kids [] /Count 0 >>',
        3 => '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    $kids = [];
    foreach ($pages as $index => $pageLines) {
        $contentObjectNumber = 4 + ($index * 2);
        $pageObjectNumber = 5 + ($index * 2);
        $kids[] = $pageObjectNumber . ' 0 R';

        $content = "BT\n/F1 12 Tf\n50 800 Td\n";
        $first = true;
        foreach ($pageLines as $line) {
            if (!$first) {
                $content .= "0 -16 Td\n";
            }
            $content .= '(' . $line . ") Tj\n";
            $first = false;
        }
        $content .= "ET\n";

        $objects[$contentObjectNumber] = "<< /Length " . strlen($content) . " >>\nstream\n" . $content . "endstream";
        $objects[$pageObjectNumber] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents " . $contentObjectNumber . " 0 R >>";
    }

    $objects[2] = "<< /Type /Pages /Kids [" . implode(' ', $kids) . "] /Count " . count($kids) . " >>";
    ksort($objects);

    $pdf = "%PDF-1.4\n";
    $offsets = [0];
    foreach ($objects as $number => $object) {
        $offsets[$number] = strlen($pdf);
        $pdf .= $number . " 0 obj\n" . $object . "\nendobj\n";
    }
    $xrefPos = strlen($pdf);
    $pdf .= "xref\n0 " . (max(array_keys($objects)) + 1) . "\n";
    $pdf .= "0000000000 65535 f \n";
    for ($i = 1; $i <= max(array_keys($objects)); $i++) {
        $offset = $offsets[$i] ?? 0;
        $pdf .= sprintf('%010d 00000 n ', $offset) . "\n";
    }
    $pdf .= "trailer\n<< /Size " . (max(array_keys($objects)) + 1) . " /Root 1 0 R /Info << /Title (" . pdf_text($title) . ") >> >>\n";
    $pdf .= "startxref\n" . $xrefPos . "\n%%EOF";

    return $pdf;
}
