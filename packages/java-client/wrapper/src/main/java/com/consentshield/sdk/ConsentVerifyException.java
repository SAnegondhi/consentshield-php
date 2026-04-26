package com.consentshield.sdk;

/**
 * Compliance-critical wrap thrown by verify calls when the SDK is fail-CLOSED
 * (the default) and the upstream cannot be reached after the retry budget is
 * exhausted (5xx, transport failure, or per-attempt timeout).
 *
 * <p>Fail-CLOSED is the safe default for verify: when in doubt, the caller
 * MUST gate the user out (HTTP 503 in a marketing flow, for example) rather
 * than treat the failure as implicit consent. To opt into fail-OPEN, set
 * {@code consentshield.fail-open=true} (Spring) or
 * {@code CONSENT_VERIFY_FAIL_OPEN=true} (env). Fail-OPEN does NOT throw —
 * it returns an {@link ConsentVerifyOutcome} carrying a {@code cause}
 * discriminator so the caller can record the override.
 *
 * <p>4xx responses are never wrapped here; they always surface as
 * {@link ConsentShieldApiException}.
 */
public final class ConsentVerifyException extends ConsentShieldException {
    private final FailureCause cause;
    private final String traceId;

    public ConsentVerifyException(FailureCause cause, String message, Throwable rootCause, String traceId) {
        super(message, rootCause);
        this.cause = cause;
        this.traceId = traceId;
    }

    public FailureCause getCause2() {
        return cause;
    }

    @Override
    public String getTraceId() {
        return traceId;
    }

    public enum FailureCause {
        /** Upstream returned 5xx after retries were exhausted. */
        SERVER_ERROR,
        /** Per-attempt timeout — never retried. */
        TIMEOUT,
        /** Transport failure (connection refused, DNS, TLS). */
        NETWORK,
    }
}
