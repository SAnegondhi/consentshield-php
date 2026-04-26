<?php declare(strict_types=1);

namespace ConsentShield\Sdk\Exception;

enum VerifyFailureCause: string
{
    /** Upstream returned 5xx after retries were exhausted. */
    case ServerError = 'server_error';

    /** Per-attempt timeout — never retried. */
    case Timeout = 'timeout';

    /** Transport failure (connection refused, DNS, TLS). */
    case Network = 'network';
}
