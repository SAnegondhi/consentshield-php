package com.consentshield.sdk;

import java.time.Duration;
import java.util.Objects;
import java.util.concurrent.TimeUnit;

import com.consentshield.sdk.internal.RetryInterceptor;
import com.consentshield.sdk.invoker.ApiClient;

import okhttp3.OkHttpClient;

/**
 * Factory + facade over the generated {@link ApiClient} that wires:
 *
 * <ul>
 *   <li>Bearer auth from {@code apiKey} (must start with {@code cs_live_}).</li>
 *   <li>2 s per-attempt timeout (overridable via {@link Builder#timeout(Duration)}).</li>
 *   <li>{@link RetryInterceptor} with 100/400/1600 ms backoff, 3 retries
 *       (5xx + transport only; never 4xx; never timeouts).</li>
 *   <li>Fail-CLOSED by default; opt into fail-OPEN via
 *       {@link Builder#failOpen(boolean)} or {@code CONSENT_VERIFY_FAIL_OPEN=true} env var
 *       (the explicit setter wins over env).</li>
 * </ul>
 *
 * <p>Typical use:
 * <pre>{@code
 *   ConsentShieldClient client = ConsentShieldClient.builder()
 *       .apiKey(System.getenv("CONSENTSHIELD_API_KEY"))
 *       .build();
 *   PingResponse ping = client.api().ping(null);
 * }</pre>
 *
 * <p>Spring Boot users typically inject {@link ConsentShieldClient} as a
 * bean rather than calling {@link #builder()} directly — see
 * {@code com.consentshield.sdk.spring.ConsentShieldAutoConfiguration}.
 */
public final class ConsentShieldClient {
    public static final String DEFAULT_BASE_URL = "https://api.consentshield.in/v1";
    public static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(2);
    public static final int DEFAULT_MAX_RETRIES = 3;

    private static final String API_KEY_PREFIX = "cs_live_";

    private final ApiClient apiClient;
    private final boolean failOpen;
    private final String baseUrl;

    private ConsentShieldClient(ApiClient apiClient, boolean failOpen, String baseUrl) {
        this.apiClient = apiClient;
        this.failOpen = failOpen;
        this.baseUrl = baseUrl;
    }

    public ApiClient api() {
        return apiClient;
    }

    public boolean isFailOpen() {
        return failOpen;
    }

    public String getBaseUrl() {
        return baseUrl;
    }

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private String apiKey;
        private String baseUrl = DEFAULT_BASE_URL;
        private Duration timeout = DEFAULT_TIMEOUT;
        private int maxRetries = DEFAULT_MAX_RETRIES;
        private Boolean failOpen; // null = inherit from env

        public Builder apiKey(String apiKey) {
            this.apiKey = apiKey;
            return this;
        }

        public Builder baseUrl(String baseUrl) {
            this.baseUrl = baseUrl;
            return this;
        }

        public Builder timeout(Duration timeout) {
            this.timeout = timeout;
            return this;
        }

        public Builder maxRetries(int maxRetries) {
            this.maxRetries = maxRetries;
            return this;
        }

        public Builder failOpen(boolean failOpen) {
            this.failOpen = failOpen;
            return this;
        }

        public ConsentShieldClient build() {
            Objects.requireNonNull(apiKey, "apiKey is required");
            if (!apiKey.startsWith(API_KEY_PREFIX)) {
                throw new IllegalArgumentException(
                        "apiKey must start with '" + API_KEY_PREFIX + "'");
            }
            if (timeout.isNegative() || timeout.isZero()) {
                throw new IllegalArgumentException("timeout must be > 0");
            }
            if (maxRetries < 0) {
                throw new IllegalArgumentException("maxRetries must be >= 0");
            }

            String trimmedBase = baseUrl.endsWith("/")
                    ? baseUrl.substring(0, baseUrl.length() - 1)
                    : baseUrl;

            // Per-attempt timeout via connect/read/write — NOT callTimeout, which
            // caps the whole call (including all retry sleeps) and defeats the
            // retry budget. The retry interceptor handles the cumulative time.
            OkHttpClient httpClient = new OkHttpClient.Builder()
                    .connectTimeout(timeout.toMillis(), TimeUnit.MILLISECONDS)
                    .readTimeout(timeout.toMillis(), TimeUnit.MILLISECONDS)
                    .writeTimeout(timeout.toMillis(), TimeUnit.MILLISECONDS)
                    .addInterceptor(new RetryInterceptor(maxRetries))
                    .build();

            ApiClient apiClient = new ApiClient(httpClient);
            apiClient.setBasePath(trimmedBase);
            apiClient.setBearerToken(apiKey);

            boolean resolvedFailOpen = failOpen != null ? failOpen : envFailOpen();

            return new ConsentShieldClient(apiClient, resolvedFailOpen, trimmedBase);
        }

        private static boolean envFailOpen() {
            String v = System.getenv("CONSENT_VERIFY_FAIL_OPEN");
            return v != null && v.equalsIgnoreCase("true");
        }
    }
}
