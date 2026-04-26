package com.consentshield.sdk;

/**
 * Base type for every exception thrown by the ConsentShield SDK.
 *
 * <p>Concrete subtypes:
 * <ul>
 *   <li>{@link ConsentShieldApiException} — 4xx API errors. ALWAYS surfaces.</li>
 *   <li>{@link ConsentShieldTimeoutException} — per-attempt timeout. NEVER retried.</li>
 *   <li>{@link ConsentVerifyException} — compliance-critical wrap on verify-call failures
 *       (5xx / network / timeout) when fail-CLOSED.</li>
 * </ul>
 *
 * <p>{@link #getTraceId()} returns the {@code X-CS-Trace-Id} header value
 * round-tripped from the server, or {@code null} if the call never reached
 * one (network error before any response arrived).
 */
public abstract class ConsentShieldException extends RuntimeException {
    protected ConsentShieldException(String message) {
        super(message);
    }

    protected ConsentShieldException(String message, Throwable cause) {
        super(message, cause);
    }

    public abstract String getTraceId();
}
