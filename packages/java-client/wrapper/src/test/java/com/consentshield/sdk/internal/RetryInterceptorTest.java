package com.consentshield.sdk.internal;

import java.io.IOException;
import java.io.InterruptedIOException;
import java.net.SocketTimeoutException;
import java.time.Duration;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import okhttp3.Interceptor;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RetryInterceptorTest {
    private MockWebServer server;

    @BeforeEach
    void start() throws IOException {
        server = new MockWebServer();
        server.start();
    }

    @AfterEach
    void stop() throws IOException {
        server.shutdown();
    }

    private OkHttpClient clientWithRetries(int maxRetries) {
        // Per-attempt timeout via read/connect — callTimeout would cap the whole
        // call (including retry sleeps) and defeat the contract under test.
        return new OkHttpClient.Builder()
                .connectTimeout(Duration.ofSeconds(2))
                .readTimeout(Duration.ofSeconds(2))
                .writeTimeout(Duration.ofSeconds(2))
                .addInterceptor(new RetryInterceptor(maxRetries))
                .build();
    }

    @Test
    void twoXxNeverRetried() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(200).setBody("{}"));

        OkHttpClient client = clientWithRetries(3);
        try (Response r = client.newCall(new Request.Builder().url(server.url("/x")).build()).execute()) {
            assertEquals(200, r.code());
        }
        assertEquals(1, server.getRequestCount());
    }

    @Test
    void fourXxNeverRetried() throws Exception {
        for (int code : new int[]{400, 401, 403, 404, 410, 422}) {
            MockWebServer s = new MockWebServer();
            s.start();
            try {
                s.enqueue(new MockResponse().setResponseCode(code).setBody(""));
                OkHttpClient client = clientWithRetries(3);
                try (Response r = client.newCall(new Request.Builder().url(s.url("/x")).build()).execute()) {
                    assertEquals(code, r.code());
                }
                assertEquals(1, s.getRequestCount(), "4xx code " + code + " must not retry");
            } finally {
                s.shutdown();
            }
        }
    }

    @Test
    void fiveXxRetriesUntilSuccess() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(503));
        server.enqueue(new MockResponse().setResponseCode(503));
        server.enqueue(new MockResponse().setResponseCode(200).setBody("{}"));

        OkHttpClient client = clientWithRetries(3);
        try (Response r = client.newCall(new Request.Builder().url(server.url("/x")).build()).execute()) {
            assertEquals(200, r.code());
        }
        assertEquals(3, server.getRequestCount());
    }

    @Test
    void fiveXxExhaustsRetriesThenSurfaces() throws Exception {
        for (int i = 0; i < 4; i++) server.enqueue(new MockResponse().setResponseCode(503));

        OkHttpClient client = clientWithRetries(3);
        try (Response r = client.newCall(new Request.Builder().url(server.url("/x")).build()).execute()) {
            assertEquals(503, r.code());
        }
        assertEquals(4, server.getRequestCount());
    }

    @Test
    void timeoutNeverRetried() throws Exception {
        // Server delays the headers (read timeout fires).
        server.enqueue(new MockResponse().setResponseCode(200).setHeadersDelay(2, TimeUnit.SECONDS).setBody("{}"));

        OkHttpClient client = new OkHttpClient.Builder()
                .connectTimeout(Duration.ofMillis(200))
                .readTimeout(Duration.ofMillis(200))
                .writeTimeout(Duration.ofMillis(200))
                .addInterceptor(new RetryInterceptor(3))
                .build();

        Throwable thrown = assertThrows(IOException.class,
                () -> client.newCall(new Request.Builder().url(server.url("/x")).build()).execute());
        assertTrue(
                thrown instanceof SocketTimeoutException
                        || (thrown instanceof InterruptedIOException
                                && thrown.getMessage() != null
                                && thrown.getMessage().toLowerCase().contains("timeout")),
                "expected timeout-shaped exception, got " + thrown);

        // Critically: only ONE attempt was made.
        assertEquals(1, server.getRequestCount());
    }

    @Test
    void networkErrorRetriedThenSurfaces() throws Exception {
        // Build a chain that fails the first attempt with an IOException.
        AtomicInteger calls = new AtomicInteger(0);
        Interceptor failing = chain -> {
            int n = calls.incrementAndGet();
            if (n <= 2) throw new IOException("simulated transport failure #" + n);
            return chain.proceed(chain.request());
        };

        server.enqueue(new MockResponse().setResponseCode(200).setBody("{}"));

        OkHttpClient client = new OkHttpClient.Builder()
                .connectTimeout(Duration.ofSeconds(2))
                .readTimeout(Duration.ofSeconds(2))
                .writeTimeout(Duration.ofSeconds(2))
                .addInterceptor(new RetryInterceptor(3))
                .addInterceptor(failing)
                .build();

        try (Response r = client.newCall(new Request.Builder().url(server.url("/x")).build()).execute()) {
            assertEquals(200, r.code());
        }
        assertEquals(3, calls.get());
    }

    @Test
    void zeroRetriesMeansOneAttempt() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(503));

        OkHttpClient client = clientWithRetries(0);
        try (Response r = client.newCall(new Request.Builder().url(server.url("/x")).build()).execute()) {
            assertEquals(503, r.code());
        }
        assertEquals(1, server.getRequestCount());
    }

    @Test
    void invalidMaxRetriesRejected() {
        assertThrows(IllegalArgumentException.class, () -> new RetryInterceptor(-1));
        assertThrows(IllegalArgumentException.class, () -> new RetryInterceptor(99));
    }
}
