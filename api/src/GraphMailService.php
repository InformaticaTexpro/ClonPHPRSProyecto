<?php
declare(strict_types=1);

// Transporte compartido con recuperación de contraseña. Nunca registra secretos.
final class GraphMailService
{
    public function send(array $recipients, string $subject, string $html): int
    {
        $tenant = (string)env('MAIL_TENANT_ID', '');
        $client = (string)env('MAIL_CLIENT_ID', '');
        $secret = (string)env('MAIL_CLIENT_SECRET', '');
        $from = (string)env('MAIL_FROM_ADDRESS', '');
        if ($tenant === '' || $client === '' || $secret === '' || $from === '') {
            throw new RuntimeException('Faltan variables de correo Microsoft Graph en .env', 500);
        }
        if (!$recipients) throw new RuntimeException('Faltan destinatarios.', 422);
        $to = [];
        foreach (array_unique($recipients) as $email) {
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw new RuntimeException('Destinatario inválido.', 422);
            $to[] = ['emailAddress'=>['address'=>$email]];
        }
        $token = $this->fetch_graph_access_token($tenant, $client, $secret);
        $payload = json_encode(['message'=>['subject'=>$subject,
            'body'=>['contentType'=>'HTML','content'=>$html], 'toRecipients'=>$to],
            'saveToSentItems'=>false], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $response = $this->httpPost('https://graph.microsoft.com/v1.0/users/' . rawurlencode($from) . '/sendMail',
            $payload, ['Authorization: Bearer ' . $token, 'Content-Type: application/json', 'Content-Length: ' . strlen($payload)]);
        if ($response['status'] !== 202) throw new RuntimeException('Microsoft Graph no pudo enviar el correo (HTTP ' . $response['status'] . ').', 500);
        return $response['status'];
    }

    private function fetch_graph_access_token(string $tenantId, string $clientId, string $clientSecret): string
    {
        $post = http_build_query([
            'grant_type' => 'client_credentials',
            'client_id' => $clientId,
            'client_secret' => $clientSecret,
            'scope' => 'https://graph.microsoft.com/.default',
        ]);

        $response = $this->httpPost(
            'https://login.microsoftonline.com/' . rawurlencode($tenantId) . '/oauth2/v2.0/token',
            $post,
            [
                'Content-Type: application/x-www-form-urlencoded',
                'Content-Length: ' . strlen($post),
            ]
        );

        if ($response['status'] < 200 || $response['status'] >= 300) {
            throw new RuntimeException('Error obteniendo token de Microsoft Graph (HTTP ' . $response['status'] . ').', 500);
        }

        $json = json_decode((string)$response['body'], true);
        if (!is_array($json) || empty($json['access_token'])) {
            throw new RuntimeException('Respuesta inválida de Microsoft Graph', 500);
        }

        return (string)$json['access_token'];
    }

    private function httpPost(string $url, string $body, array $headers): array
    {
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            if ($ch === false) {
                throw new RuntimeException('No se pudo inicializar cURL para Microsoft Graph.', 500);
            }

            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => $body,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_CONNECTTIMEOUT => 15,
                CURLOPT_TIMEOUT => 30,
                CURLOPT_FOLLOWLOCATION => false,
            ]);

            $response = curl_exec($ch);
            $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $errno = curl_errno($ch);
            $error = curl_error($ch);
            curl_close($ch);

            if ($response === false) {
                $detail = $error !== '' ? $error : ('cURL error ' . $errno);
                throw new RuntimeException('No se pudo conectar con Microsoft Graph: ' . $detail, 500);
            }

            return [
                'status' => $status,
                'body' => (string)$response,
            ];
        }

        if (!in_array('https', stream_get_wrappers(), true)) {
            throw new RuntimeException('No se pudo conectar con Microsoft Graph: el servidor no tiene wrapper HTTPS habilitado y tampoco cURL.', 500);
        }

        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => implode("\r\n", $headers),
                'content' => $body,
                'timeout' => 30,
                'ignore_errors' => true,
            ],
            'ssl' => [
                'verify_peer' => true,
                'verify_peer_name' => true,
            ],
        ]);

        $response = @file_get_contents($url, false, $context);
        $status = 0;
        if (!empty($http_response_header[0]) && preg_match('#HTTP/\S+\s+(\d{3})#', $http_response_header[0], $matches)) {
            $status = (int)$matches[1];
        }

        if ($response === false) {
            $error = error_get_last();
            throw new RuntimeException('No se pudo conectar con Microsoft Graph: ' . ($error['message'] ?? 'error desconocido'), 500);
        }

        return [
            'status' => $status,
            'body' => (string)$response,
        ];
    }

}
