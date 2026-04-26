package com.consentshield.sdk;

import java.util.Optional;

/**
 * Discriminated result of a verify call: either a server-decided envelope
 * (granted / denied) or a fail-OPEN escape hatch with the cause recorded.
 *
 * <p>Callers that opt into fail-OPEN see this type even on transport
 * failures; the {@code openCause} is set so the caller can record the
 * override in their own audit log.
 */
public final class ConsentVerifyOutcome {
    private final Object envelope;
    private final ConsentVerifyException.FailureCause openCause;
    private final String traceId;

    private ConsentVerifyOutcome(Object envelope, ConsentVerifyException.FailureCause openCause, String traceId) {
        this.envelope = envelope;
        this.openCause = openCause;
        this.traceId = traceId;
    }

    public static ConsentVerifyOutcome ofEnvelope(Object envelope, String traceId) {
        return new ConsentVerifyOutcome(envelope, null, traceId);
    }

    public static ConsentVerifyOutcome ofOpen(ConsentVerifyException.FailureCause cause, String traceId) {
        return new ConsentVerifyOutcome(null, cause, traceId);
    }

    public boolean isOpen() {
        return openCause != null;
    }

    public Optional<Object> getEnvelope() {
        return Optional.ofNullable(envelope);
    }

    public Optional<ConsentVerifyException.FailureCause> getOpenCause() {
        return Optional.ofNullable(openCause);
    }

    public String getTraceId() {
        return traceId;
    }
}
