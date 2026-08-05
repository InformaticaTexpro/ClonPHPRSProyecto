<?php
declare(strict_types=1);

final class IndicadoresService
{
    private const CACHE_TTL = 1800;
    private const FETCH_TIMEOUT = 5;
    private const FETCH_RETRIES = 2;

    public function get(array $query = []): array
    {
        $cache = $this->loadCache();
        $now = time();
        if ($cache && isset($cache['cacheTS'], $cache['data']) && ($now - (int)$cache['cacheTS']) < self::CACHE_TTL) {
            $data = $cache['data'];
            $data['disponible'] = true;
            $data['stale'] = false;
            return $data;
        }

        try {
            $dolar = $this->fetchFindic('dolar');
            $uf = $this->fetchFindic('uf');
            $payload = [
                'ok' => true,
                'dolar' => $dolar,
                'uf' => $uf,
                'fuente' => 'findic.cl',
                'actualizadoEn' => gmdate('c'),
                'disponible' => true,
                'stale' => false,
            ];
            $this->saveCache([
                'cacheTS' => $now,
                'data' => $payload,
            ]);
            return $payload;
        } catch (Throwable) {
            if ($cache && isset($cache['data'])) {
                $data = $cache['data'];
                $data['disponible'] = true;
                $data['stale'] = true;
                return $data;
            }

            return [
                'ok' => true,
                'disponible' => false,
                'dolar' => null,
                'uf' => null,
                'fuente' => 'findic.cl',
                'actualizadoEn' => null,
                'stale' => false,
            ];
        }
    }

    private function cachePath(): string
    {
        return rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'rsproyecto_indicadores_cache.json';
    }

    private function loadCache(): ?array
    {
        $path = $this->cachePath();
        if (!is_file($path)) {
            return null;
        }
        $raw = file_get_contents($path);
        if ($raw === false) {
            return null;
        }
        $data = json_decode($raw, true);
        return is_array($data) ? $data : null;
    }

    private function saveCache(array $payload): void
    {
        @file_put_contents($this->cachePath(), json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }

    private function fetchJson(string $url, int $retries = self::FETCH_RETRIES): array
    {
        $lastError = null;

        while ($retries-- >= 0) {
            try {
                if (function_exists('curl_init')) {
                    $ch = curl_init();
                    curl_setopt_array($ch, [
                        CURLOPT_URL => $url,
                        CURLOPT_RETURNTRANSFER => true,
                        CURLOPT_FOLLOWLOCATION => true,
                        CURLOPT_TIMEOUT => self::FETCH_TIMEOUT,
                        CURLOPT_HTTPHEADER => [
                            'User-Agent: RSProyecto/1.0',
                            'Accept: application/json',
                        ],
                    ]);

                    $response = curl_exec($ch);
                    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
                    if ($response !== false && $status >= 200 && $status < 300) {
                        curl_close($ch);
                        $json = json_decode((string)$response, true);
                        if (is_array($json)) {
                            return $json;
                        }
                        $lastError = 'Respuesta JSON invalida';
                    } else {
                        $lastError = curl_error($ch) ?: (string)$response;
                    }
                    curl_close($ch);
                } else {
                    $context = stream_context_create([
                        'http' => [
                            'method' => 'GET',
                            'timeout' => self::FETCH_TIMEOUT,
                            'header' => implode("\r\n", [
                                'User-Agent: RSProyecto/1.0',
                                'Accept: application/json',
                            ]),
                        ],
                        'ssl' => [
                            'verify_peer' => true,
                            'verify_peer_name' => true,
                        ],
                    ]);

                    $response = @file_get_contents($url, false, $context);
                    $statusLine = $http_response_header[0] ?? '';
                    $status = preg_match('/\s(\d{3})\s/', (string)$statusLine, $m) ? (int)$m[1] : 0;
                    if ($response !== false && $status >= 200 && $status < 300) {
                        $json = json_decode((string)$response, true);
                        if (is_array($json)) {
                            return $json;
                        }
                        $lastError = 'Respuesta JSON invalida';
                    } else {
                        $lastError = $statusLine ?: 'Error de red';
                    }
                }
            } catch (Throwable $e) {
                $lastError = $e->getMessage();
            }

            if ($retries >= 0) {
                usleep(750000);
            }
        }

        throw new RuntimeException($lastError ?: 'Error de red', 500);
    }

    private function fetchFindic(string $indicador): array
    {
        $data = $this->fetchJson('https://findic.cl/api/' . rawurlencode($indicador), self::FETCH_RETRIES);
        $serie = $data['serie'] ?? null;
        if (!is_array($serie) || !$serie) {
            throw new RuntimeException('Sin serie: ' . $indicador, 500);
        }

        $last = $serie[0] ?? null;
        $value = $last['valor'] ?? null;
        if ($value === null || !is_numeric($value)) {
            throw new RuntimeException('Valor invalido: ' . $indicador, 500);
        }

        return [
            'valor' => (float)$value,
            'fecha' => substr((string)($last['fecha'] ?? ''), 0, 10),
        ];
    }
}
