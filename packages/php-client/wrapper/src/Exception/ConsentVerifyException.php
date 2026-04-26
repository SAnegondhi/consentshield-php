<?php declare(strict_types=1);

namespace ConsentShield\Sdk\Exception;

/**
 * Compliance-critical wrap thrown by verify calls when fail-CLOSED (default)
 * and the upstream cannot be reached after the retry budget is exhausted
 * (5xx, transport failure, or per-attempt timeout). 4xx responses are NEVER
 * wrapped here; they always surface as ConsentShieldApiException.
 */
final class ConsentVerifyException extends ConsentShieldException
{
    public function __construct(
        private readonly VerifyFailureCause $cause,
        string $message,
        ?string $traceId = null,
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, $traceId, $previous);
    }

    public function getCauseCode(): VerifyFailureCause
    {
        return $this->cause;
    }
}
