<?php declare(strict_types=1);

namespace ConsentShield\Sdk\Exception;

/**
 * Base type for every exception thrown by the ConsentShield SDK wrapper.
 *
 * Subtypes:
 *  - ConsentShieldApiException   — 4xx API errors. ALWAYS surfaces.
 *  - ConsentShieldTimeoutException — per-attempt timeout. NEVER retried.
 *  - ConsentVerifyException      — compliance-critical wrap on verify-call
 *                                   failures (5xx / network / timeout) when
 *                                   fail-CLOSED.
 *
 * `getTraceId()` returns the X-CS-Trace-Id header value round-tripped from
 * the server, or null if the call never reached one.
 */
abstract class ConsentShieldException extends \RuntimeException
{
    private ?string $traceId;

    public function __construct(string $message, ?string $traceId = null, ?\Throwable $previous = null)
    {
        parent::__construct($message, 0, $previous);
        $this->traceId = $traceId;
    }

    public function getTraceId(): ?string
    {
        return $this->traceId;
    }
}
