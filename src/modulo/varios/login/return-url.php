<?php
declare(strict_types=1);

// Retorno al módulo: solo rutas locales conocidas, nunca destinos externos.
function clientes_prospectos_return_url(mixed $value): string
{
    if (!is_string($value) || strlen($value)>2048 || strpbrk($value,'<>') !== false || preg_match('/[\\\\\x00-\x20\x7f]/',$value)) return '';
    $parts = parse_url($value);
    if ($parts === false || isset($parts['scheme']) || isset($parts['host'])) return '';
    if (!in_array($parts['path'] ?? '',[
        '/src/modulo/ventas/clientes-prospectos/index.html',
        '/src/modulo/cobranza/clientes-prospectos/index.html',
    ],true)) return '';
    return $value;
}
