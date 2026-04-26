<?php declare(strict_types=1);

namespace ConsentShield\Sdk\Exception;

/**
 * Thrown when a request exceeds the per-attempt timeout. NEVER retried —
 * burning the retry budget on more timeouts just delays the inevitable.
 */
final class ConsentShieldTimeoutException extends ConsentShieldException
{
}
