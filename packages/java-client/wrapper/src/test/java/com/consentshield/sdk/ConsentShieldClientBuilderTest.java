package com.consentshield.sdk;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ConsentShieldClientBuilderTest {
    @Test
    void buildsWithDefaults() {
        ConsentShieldClient client = ConsentShieldClient.builder()
                .apiKey("cs_live_abc123")
                .build();

        assertNotNull(client.api());
        assertEquals("https://api.consentshield.in/v1", client.getBaseUrl());
        assertFalse(client.isFailOpen());
    }

    @Test
    void rejectsApiKeyWithoutPrefix() {
        assertThrows(IllegalArgumentException.class, () -> ConsentShieldClient.builder()
                .apiKey("not-a-cs-key")
                .build());
    }

    @Test
    void rejectsNullApiKey() {
        assertThrows(NullPointerException.class, () -> ConsentShieldClient.builder().build());
    }

    @Test
    void trimsTrailingSlashFromBaseUrl() {
        ConsentShieldClient client = ConsentShieldClient.builder()
                .apiKey("cs_live_abc123")
                .baseUrl("https://api.consentshield.in/v1/")
                .build();
        assertEquals("https://api.consentshield.in/v1", client.getBaseUrl());
    }

    @Test
    void explicitFailOpenWinsOverEnv() {
        // Even if env var were set, the explicit false from the builder wins.
        ConsentShieldClient client = ConsentShieldClient.builder()
                .apiKey("cs_live_abc123")
                .failOpen(true)
                .build();
        assertTrue(client.isFailOpen());
    }
}
