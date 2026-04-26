package com.consentshield.sdk.internal;

import java.io.IOException;
import java.io.InterruptedIOException;
import java.net.SocketTimeoutException;

import okhttp3.Interceptor;
import okhttp3.Request;
import okhttp3.Response;

/**
 * OkHttp interceptor implementing the ConsentShield retry contract:
 *
 * <ul>
 *   <li>Up to {@code maxRetries} retries on 5xx and on transport IOException
 *       (connection refused, DNS, TLS, broken pipe).</li>
 *   <li>Backoff: 100 ms, 400 ms, 1600 ms (exponential, base 4).</li>
 *   <li>NEVER retries 4xx — those surface as the FIRST attempt's response.</li>
 *   <li>NEVER retries per-attempt timeout ({@link SocketTimeoutException} or
 *       {@link InterruptedIOException} with the {@code "timeout"} hint).</li>
 * </ul>
 *
 * <p>The OkHttp client this interceptor lives on must already have its
 * {@code callTimeout} / {@code readTimeout} set to the desired per-attempt
 * timeout.
 */
public final class RetryInterceptor implements Interceptor {
    private static final long[] BACKOFF_MS = {100L, 400L, 1600L};

    private final int maxRetries;

    public RetryInterceptor(int maxRetries) {
        if (maxRetries < 0 || maxRetries > BACKOFF_MS.length) {
            throw new IllegalArgumentException(
                    "maxRetries must be 0.." + BACKOFF_MS.length + ", got " + maxRetries);
        }
        this.maxRetries = maxRetries;
    }

    @Override
    public Response intercept(Chain chain) throws IOException {
        Request request = chain.request();
        IOException lastTransport = null;
        Response lastResponse = null;

        for (int attempt = 0; attempt <= maxRetries; attempt++) {
            if (attempt > 0) {
                sleep(BACKOFF_MS[attempt - 1]);
            }

            // Close the previous response body if we're retrying after a 5xx.
            if (lastResponse != null) {
                lastResponse.close();
                lastResponse = null;
            }

            try {
                Response response = chain.proceed(request);
                int code = response.code();

                if (code < 500) {
                    // 2xx, 3xx, 4xx — return as-is. Never retry 4xx.
                    return response;
                }

                // 5xx — retry if we have budget, else surface as the final response.
                if (attempt == maxRetries) {
                    return response;
                }
                lastResponse = response;
            } catch (SocketTimeoutException timeout) {
                // Per-attempt timeout — NEVER retried.
                throw timeout;
            } catch (InterruptedIOException ioe) {
                // OkHttp signals callTimeout via InterruptedIOException("timeout").
                if (ioe.getMessage() != null && ioe.getMessage().toLowerCase().contains("timeout")) {
                    throw ioe;
                }
                lastTransport = ioe;
                if (attempt == maxRetries) {
                    throw ioe;
                }
            } catch (IOException ioe) {
                // Transport failure — retry if we have budget.
                lastTransport = ioe;
                if (attempt == maxRetries) {
                    throw ioe;
                }
            }
        }

        if (lastResponse != null) return lastResponse;
        if (lastTransport != null) throw lastTransport;
        throw new IllegalStateException("RetryInterceptor: unreachable");
    }

    private static void sleep(long millis) throws InterruptedIOException {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw new InterruptedIOException("retry sleep interrupted");
        }
    }
}
