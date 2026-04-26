package com.consentshield.sdk;

import java.util.Map;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ConsentShieldExceptionTest {
    @Test
    void apiExceptionCarriesAllFields() {
        ConsentShieldApiException ex = new ConsentShieldApiException(
                404, "/errors/not-found", "Not Found",
                "property_id does not belong to your org",
                "/v1/consent/verify",
                "abc-123",
                Map.of("hint", "double-check the property_id"));
        assertEquals(404, ex.getStatus());
        assertEquals("Not Found", ex.getTitle());
        assertEquals("property_id does not belong to your org", ex.getDetail());
        assertEquals("abc-123", ex.getTraceId());
        assertEquals("/v1/consent/verify", ex.getInstance());
        assertTrue(ex.getMessage().contains("404"));
    }

    @Test
    void apiExceptionToleratesNullExtensions() {
        ConsentShieldApiException ex = new ConsentShieldApiException(
                400, null, null, null, null, null, null);
        assertNotNull(ex.getExtensions());
        assertEquals(0, ex.getExtensions().size());
    }

    @Test
    void timeoutExceptionPreservesCauseAndTraceId() {
        Throwable cause = new java.net.SocketTimeoutException("read timeout");
        ConsentShieldTimeoutException ex = new ConsentShieldTimeoutException(
                "per-attempt timeout", cause, "trace-xyz");
        assertEquals("trace-xyz", ex.getTraceId());
        assertEquals(cause, ex.getCause());
    }

    @Test
    void verifyExceptionCarriesCauseDiscriminator() {
        ConsentVerifyException ex = new ConsentVerifyException(
                ConsentVerifyException.FailureCause.SERVER_ERROR,
                "5xx after retries", null, "trace-xyz");
        assertEquals(ConsentVerifyException.FailureCause.SERVER_ERROR, ex.getCause2());
        assertEquals("trace-xyz", ex.getTraceId());
    }

    @Test
    void verifyOutcomeOpenAndEnvelopeAreDistinguished() {
        ConsentVerifyOutcome ok = ConsentVerifyOutcome.ofEnvelope(new Object(), "t1");
        ConsentVerifyOutcome open = ConsentVerifyOutcome.ofOpen(
                ConsentVerifyException.FailureCause.NETWORK, "t2");

        assertEquals(false, ok.isOpen());
        assertEquals(true, open.isOpen());
        assertEquals(ConsentVerifyException.FailureCause.NETWORK, open.getOpenCause().get());
        assertEquals("t1", ok.getTraceId());
        assertEquals("t2", open.getTraceId());
    }
}
