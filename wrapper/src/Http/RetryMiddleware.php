<?php declare(strict_types=1);

namespace ConsentShield\Sdk\Http;

use ConsentShield\Sdk\Exception\ConsentShieldTimeoutException;
use GuzzleHttp\Exception\ConnectException;
use GuzzleHttp\Exception\RequestException;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;

/**
 * Guzzle middleware factory implementing the ConsentShield retry contract:
 *
 *  - Up to {@code maxRetries} retries on 5xx and on transport failure
 *    (Guzzle's ConnectException + non-timeout RequestException).
 *  - Backoff: 100 ms, 400 ms, 1600 ms (exponential, base 4).
 *  - NEVER retries 4xx — those surface as the FIRST attempt's response.
 *  - NEVER retries per-attempt timeout. The cURL handler signals timeout via
 *    `cURL error 28` inside a ConnectException; we detect and rethrow as
 *    ConsentShieldTimeoutException without consuming retry budget.
 *
 * Wire onto a HandlerStack:
 *
 *     $stack = HandlerStack::create();
 *     $stack->push(RetryMiddleware::create(maxRetries: 3));
 *     $client = new GuzzleHttp\Client(['handler' => $stack, ...]);
 */
final class RetryMiddleware
{
    /** @var array<int, int> Backoff in milliseconds, indexed by attempt-1. */
    private const BACKOFF_MS = [100, 400, 1600];

    /**
     * Returns a Guzzle middleware (RetryMiddleware-compatible factory) usable
     * via $stack->push(RetryMiddleware::create(3)).
     *
     * @param int $maxRetries 0..3
     */
    public static function create(int $maxRetries): callable
    {
        if ($maxRetries < 0 || $maxRetries > count(self::BACKOFF_MS)) {
            throw new \InvalidArgumentException(
                'maxRetries must be 0..' . count(self::BACKOFF_MS) . ", got {$maxRetries}"
            );
        }

        return static function (callable $handler) use ($maxRetries): callable {
            return static function (RequestInterface $request, array $options) use ($handler, $maxRetries) {
                return self::dispatch($handler, $request, $options, 0, $maxRetries);
            };
        };
    }

    /**
     * @param array<string, mixed> $options
     */
    private static function dispatch(
        callable $handler,
        RequestInterface $request,
        array $options,
        int $attempt,
        int $maxRetries,
    ): \GuzzleHttp\Promise\PromiseInterface {
        return $handler($request, $options)->then(
            static function (ResponseInterface $response) use ($handler, $request, $options, $attempt, $maxRetries) {
                $status = $response->getStatusCode();
                if ($status < 500) {
                    // 2xx, 3xx, 4xx — return as-is.
                    return $response;
                }
                if ($attempt >= $maxRetries) {
                    return $response;
                }
                usleep(self::BACKOFF_MS[$attempt] * 1000);
                return self::dispatch($handler, $request, $options, $attempt + 1, $maxRetries)->wait();
            },
            static function (\Throwable $reason) use ($handler, $request, $options, $attempt, $maxRetries) {
                if ($reason instanceof ConnectException && self::isTimeout($reason)) {
                    throw new ConsentShieldTimeoutException(
                        'ConsentShield API per-attempt timeout: ' . $reason->getMessage(),
                        traceId: null,
                        previous: $reason,
                    );
                }
                if (!self::isRetryable($reason)) {
                    throw $reason;
                }
                if ($attempt >= $maxRetries) {
                    throw $reason;
                }
                usleep(self::BACKOFF_MS[$attempt] * 1000);
                return self::dispatch($handler, $request, $options, $attempt + 1, $maxRetries)->wait();
            },
        );
    }

    private static function isTimeout(ConnectException $e): bool
    {
        $ctx = $e->getHandlerContext();
        if (isset($ctx['errno']) && (int)$ctx['errno'] === 28) {
            return true;
        }
        $msg = strtolower($e->getMessage());
        return str_contains($msg, 'timed out') || str_contains($msg, 'timeout');
    }

    private static function isRetryable(\Throwable $reason): bool
    {
        // Transport-level failures retry. RequestException with a 4xx response
        // does NOT retry (handled in the resolved-promise branch above; this
        // branch sees only RequestExceptions without a response, e.g. DNS,
        // refused connection).
        if ($reason instanceof ConnectException) return true;
        if ($reason instanceof RequestException && $reason->getResponse() === null) return true;
        return false;
    }
}
