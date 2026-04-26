package com.consentshield.sdk;

/**
 * Thrown when a request exceeds the per-attempt timeout (default 2 s).
 *
 * <p>Timeouts are NEVER retried — the compliance contract treats per-attempt
 * timeout as a terminal signal that the upstream is unhealthy or the network
 * is partitioned, and either way burning the retry budget on more timeouts
 * just delays the inevitable failure.
 */
public final class ConsentShieldTimeoutException extends ConsentShieldException {
    private final String traceId;

    public ConsentShieldTimeoutException(String message, Throwable cause, String traceId) {
        super(message, cause);
        this.traceId = traceId;
    }

    @Override
    public String getTraceId() {
        return traceId;
    }
}
