<?php declare(strict_types=1);

namespace ConsentShield\Sdk;

use ConsentShield\Client\Api\UtilityApi;
use ConsentShield\Client\Configuration;
use ConsentShield\Sdk\Http\RetryMiddleware;
use GuzzleHttp\Client as GuzzleClient;
use GuzzleHttp\HandlerStack;
use Psr\Http\Client\ClientInterface;

/**
 * Factory + facade over the generated client. Creates a Guzzle PSR-18 client
 * preconfigured with:
 *   - Bearer auth via Authorization header.
 *   - Per-attempt timeout (default 2 s) on connect + read.
 *   - RetryMiddleware (100/400/1600 ms backoff; never retries 4xx; never
 *     retries timeouts).
 *
 * Typical use:
 *
 *     $client = ConsentShieldClient::create(getenv('CONSENTSHIELD_API_KEY'));
 *     $ping = $client->utility()->ping();
 *
 * Callers that already use a DI container can build their own
 * GuzzleHttp\Client via {@see RetryMiddleware::create()} and pass it into
 * the generated UtilityApi/ConsentApi/etc directly.
 */
final class ConsentShieldClient
{
    public const DEFAULT_BASE_URL = 'https://api.consentshield.in/v1';
    public const DEFAULT_TIMEOUT_SECONDS = 2.0;
    public const DEFAULT_MAX_RETRIES = 3;
    public const API_KEY_PREFIX = 'cs_live_';

    private function __construct(
        private readonly ClientInterface $http,
        private readonly Configuration $config,
        private readonly bool $failOpen,
    ) {
    }

    /**
     * @param array{
     *   baseUrl?: string,
     *   timeoutSeconds?: float,
     *   maxRetries?: int,
     *   failOpen?: bool,
     * } $options
     */
    public static function create(string $apiKey, array $options = []): self
    {
        if (!str_starts_with($apiKey, self::API_KEY_PREFIX)) {
            throw new \InvalidArgumentException(
                'apiKey must start with "' . self::API_KEY_PREFIX . '"'
            );
        }

        $baseUrl = rtrim($options['baseUrl'] ?? self::DEFAULT_BASE_URL, '/');
        $timeoutSeconds = (float)($options['timeoutSeconds'] ?? self::DEFAULT_TIMEOUT_SECONDS);
        $maxRetries = (int)($options['maxRetries'] ?? self::DEFAULT_MAX_RETRIES);

        if ($timeoutSeconds <= 0) {
            throw new \InvalidArgumentException('timeoutSeconds must be > 0');
        }
        if ($maxRetries < 0) {
            throw new \InvalidArgumentException('maxRetries must be >= 0');
        }

        $explicitFailOpen = array_key_exists('failOpen', $options);
        $envFailOpen = strtolower((string)getenv('CONSENT_VERIFY_FAIL_OPEN')) === 'true';
        $failOpen = $explicitFailOpen ? (bool)$options['failOpen'] : $envFailOpen;

        $stack = HandlerStack::create();
        $stack->push(RetryMiddleware::create($maxRetries));

        $http = new GuzzleClient([
            'handler' => $stack,
            'base_uri' => $baseUrl . '/',
            'connect_timeout' => $timeoutSeconds,
            'timeout' => $timeoutSeconds,
            'http_errors' => false, // 4xx/5xx surface as Response, not exception
            'headers' => [
                'Authorization' => 'Bearer ' . $apiKey,
            ],
        ]);

        $config = (new Configuration())
            ->setHost($baseUrl)
            ->setAccessToken($apiKey);

        return new self($http, $config, $failOpen);
    }

    public function utility(): UtilityApi
    {
        return new UtilityApi($this->http, $this->config);
    }

    public function isFailOpen(): bool
    {
        return $this->failOpen;
    }

    public function getBaseUrl(): string
    {
        return $this->config->getHost();
    }
}
