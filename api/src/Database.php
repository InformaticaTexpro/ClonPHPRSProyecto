<?php
declare(strict_types=1);

final class Database
{
    private ?PDO $mysql = null;
    private ?PDO $softland = null;

    public function mysql(): PDO
    {
        if ($this->mysql instanceof PDO) {
            return $this->mysql;
        }

        $host = (string)env('DB_HOST', 'localhost');
        $port = (string)env('DB_PORT', '3306');
        $name = (string)env('DB_NAME', '');
        $user = (string)env('DB_USER', '');
        $pass = (string)env('DB_PASSWORD', '');

        if ($name === '' || $user === '') {
            throw new RuntimeException('Faltan variables de MySQL en .env', 500);
        }

        $dsn = sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $host, $port, $name);
        $this->mysql = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);

        return $this->mysql;
    }

    public function test_mysql_connection(): void
    {
        $stmt = $this->mysql()->query('SELECT 1 AS ok');
        if (!$stmt) {
            throw new RuntimeException('No se pudo validar la conexión MySQL', 500);
        }
    }

    public function softland(): PDO
    {
        if ($this->softland instanceof PDO) {
            return $this->softland;
        }

        $host = (string)env('SOFTLAND_DB_HOST', '');
        $port = (string)env('SOFTLAND_DB_PORT', '1433');
        $name = (string)env('SOFTLAND_DB_NAME', '');
        $user = (string)env('SOFTLAND_DB_USER', '');
        $pass = (string)env('SOFTLAND_DB_PASSWORD', '');
        $timeout = max(1, (int)env('SOFTLAND_DB_LOGIN_TIMEOUT', 5));
        $odbcDriver = trim((string)env('SOFTLAND_DB_ODBC_DRIVER', 'ODBC Driver 18 for SQL Server'));
        $encrypt = strtolower((string)env('SOFTLAND_DB_ENCRYPT', 'true')) === 'true' ? 'yes' : 'no';
        $trust = strtolower((string)env('SOFTLAND_DB_TRUST_SERVER_CERT', 'false')) === 'true' ? 'yes' : 'no';
        $hostnameInCert = trim((string)env('SOFTLAND_DB_HOSTNAME_IN_CERTIFICATE', ''));
        $serverCert = trim((string)env('SOFTLAND_DB_SERVER_CERTIFICATE', ''));

        if ($host === '' || $name === '' || $user === '') {
            throw new RuntimeException('Faltan variables de Softland en .env', 500);
        }

        $options = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ];

        $attempts = [
            [
                'encrypt' => $encrypt,
                'trust' => $trust,
            ],
            [
                'encrypt' => 'no',
                'trust' => 'yes',
            ],
        ];

        $uniqueAttempts = [];
        foreach ($attempts as $attempt) {
            $key = $attempt['encrypt'] . '|' . $attempt['trust'];
            $uniqueAttempts[$key] = $attempt;
        }

        $attempts = array_values($uniqueAttempts);

        $extraSqlsrvOptions = [];
        if ($hostnameInCert !== '') {
            $extraSqlsrvOptions[] = 'HostnameInCertificate=' . $hostnameInCert;
        }
        if ($serverCert !== '') {
            $extraSqlsrvOptions[] = 'ServerCertificate=' . $serverCert;
        }
        if ($extraSqlsrvOptions) {
            $extraSqlsrvOptions[] = 'ConnectRetryCount=1';
        }

        $buildSqlsrvDsn = static function (
            string $host,
            string $port,
            string $name,
            string $encryptValue,
            string $trustValue,
            int $timeoutValue,
            array $extras
        ): string {
            $dsn = sprintf(
                'sqlsrv:Server=%s,%s;Database=%s;Encrypt=%s;TrustServerCertificate=%s;LoginTimeout=%d',
                $host,
                $port,
                $name,
                $encryptValue,
                $trustValue,
                $timeoutValue
            );

            if ($extras) {
                $dsn .= ';' . implode(';', $extras);
            }

            return $dsn;
        };

        $buildOdbcDsn = static function (
            string $driver,
            string $host,
            string $port,
            string $name,
            string $encryptValue,
            string $trustValue,
            int $timeoutValue,
            array $extras
        ): string {
            $dsn = sprintf(
                'odbc:Driver={%s};Server=tcp:%s,%s;Database=%s;Encrypt=%s;TrustServerCertificate=%s;LoginTimeout=%d',
                $driver,
                $host,
                $port,
                $name,
                $encryptValue,
                $trustValue,
                $timeoutValue
            );

            if ($extras) {
                $dsn .= ';' . implode(';', $extras);
            }

            return $dsn;
        };

        $drivers = PDO::getAvailableDrivers();
        if (in_array('sqlsrv', $drivers, true)) {
            foreach ($attempts as $attempt) {
                $dsn = $buildSqlsrvDsn($host, $port, $name, $attempt['encrypt'], $attempt['trust'], $timeout, $extraSqlsrvOptions);

                try {
                    $this->softland = new PDO($dsn, $user, $pass, $options);
                    return $this->softland;
                } catch (Throwable $e) {
                    $message = strtolower($e->getMessage());
                    $retryable =
                        str_contains($message, 'encryption not supported on the client')
                        || str_contains($message, 'error de seguridad de ssl')
                        || str_contains($message, 'dbnetlib')
                        || str_contains($message, 'ssl')
                        || str_contains($message, 'certificate chain was issued by an authority that is not trusted')
                        || str_contains($message, 'ssl provider');

                    if (!$retryable) {
                        throw $e;
                    }
                }
            }
        }

        if (in_array('odbc', $drivers, true)) {
            $lastError = null;
            $extraOdbcOptions = [];
            if ($hostnameInCert !== '') {
                $extraOdbcOptions[] = 'HostnameInCertificate=' . $hostnameInCert;
            }
            if ($serverCert !== '') {
                $extraOdbcOptions[] = 'ServerCertificate=' . $serverCert;
            }

            foreach ($attempts as $attempt) {
                $dsn = $buildOdbcDsn($odbcDriver, $host, $port, $name, $attempt['encrypt'], $attempt['trust'], $timeout, $extraOdbcOptions);

                try {
                    $this->softland = new PDO($dsn, $user, $pass, $options);
                    return $this->softland;
                } catch (Throwable $e) {
                    $message = strtolower($e->getMessage());
                    $retryable =
                        str_contains($message, 'data source name not found')
                        || (str_contains($message, 'driver') && str_contains($message, 'not found'))
                        || str_contains($message, 'encryption not supported on the client')
                        || str_contains($message, 'error de seguridad de ssl')
                        || str_contains($message, 'dbnetlib')
                        || str_contains($message, 'ssl')
                        || str_contains($message, 'certificate chain was issued by an authority that is not trusted')
                        || str_contains($message, 'ssl provider');

                    if ($retryable) {
                        $lastError = $e;
                        continue;
                    }

                    throw $e;
                }
            }

            throw new RuntimeException(
                'No se pudo abrir la conexión Softland vía ODBC. ' . ($lastError ? $lastError->getMessage() : 'Verifica el driver ODBC de SQL Server.'),
                500
            );
        }

        throw new RuntimeException('No hay driver disponible para conectar a Softland. Se requiere PDO_SQLSRV o PDO_ODBC.', 500);
    }

    public function softlandAvailable(): bool
    {
        $drivers = PDO::getAvailableDrivers();
        return in_array('sqlsrv', $drivers, true) || in_array('odbc', $drivers, true);
    }

    public function fetchOne(string $sql, array $params = []): ?array
    {
        $stmt = $this->mysql()->prepare($sql);
        $stmt->execute(array_values($params));
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    public function fetchAll(string $sql, array $params = []): array
    {
        $stmt = $this->mysql()->prepare($sql);
        $stmt->execute(array_values($params));
        return $stmt->fetchAll();
    }

    public function execute(string $sql, array $params = []): int
    {
        $stmt = $this->mysql()->prepare($sql);
        $stmt->execute(array_values($params));
        return $stmt->rowCount();
    }
}
