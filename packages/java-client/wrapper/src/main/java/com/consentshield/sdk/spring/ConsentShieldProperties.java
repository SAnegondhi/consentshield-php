package com.consentshield.sdk.spring;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Properties bound under {@code consentshield.*} via Spring Boot's
 * {@code @ConfigurationProperties}. Values can also be set via
 * {@code application.properties} / {@code application.yml} / environment
 * (e.g. {@code CONSENTSHIELD_API_KEY}).
 */
@ConfigurationProperties(prefix = "consentshield")
public class ConsentShieldProperties {
    /** API key prefixed with {@code cs_live_}. Required. */
    private String apiKey;

    /** API base URL. Defaults to https://api.consentshield.in/v1. */
    private String baseUrl = "https://api.consentshield.in/v1";

    /** Per-attempt timeout. Defaults to 2 s. */
    private Duration timeout = Duration.ofSeconds(2);

    /** Max retries on 5xx + transport. Defaults to 3 (so 4 total attempts). */
    private int maxRetries = 3;

    /**
     * If true, verify failures (5xx / network / timeout) return an open
     * outcome rather than throwing {@code ConsentVerifyException}. Defaults to
     * false (fail-CLOSED), matching the Tier-1 SDKs.
     */
    private boolean failOpen = false;

    public String getApiKey() {
        return apiKey;
    }

    public void setApiKey(String apiKey) {
        this.apiKey = apiKey;
    }

    public String getBaseUrl() {
        return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    public Duration getTimeout() {
        return timeout;
    }

    public void setTimeout(Duration timeout) {
        this.timeout = timeout;
    }

    public int getMaxRetries() {
        return maxRetries;
    }

    public void setMaxRetries(int maxRetries) {
        this.maxRetries = maxRetries;
    }

    public boolean isFailOpen() {
        return failOpen;
    }

    public void setFailOpen(boolean failOpen) {
        this.failOpen = failOpen;
    }
}
