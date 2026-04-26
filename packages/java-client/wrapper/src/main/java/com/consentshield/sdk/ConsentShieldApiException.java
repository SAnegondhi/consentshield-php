package com.consentshield.sdk;

import java.util.Map;

/**
 * Thrown when the ConsentShield API returns a 4xx response.
 *
 * <p>4xx responses ALWAYS surface — they are never retried, never folded into
 * fail-OPEN handling. The compliance contract requires the caller to see the
 * problem+json detail (RFC 7807) so they can correct the request.
 */
public final class ConsentShieldApiException extends ConsentShieldException {
    private final int status;
    private final String type;
    private final String title;
    private final String detail;
    private final String instance;
    private final String traceId;
    private final Map<String, Object> extensions;

    public ConsentShieldApiException(
            int status,
            String type,
            String title,
            String detail,
            String instance,
            String traceId,
            Map<String, Object> extensions) {
        super(buildMessage(status, title, detail));
        this.status = status;
        this.type = type;
        this.title = title;
        this.detail = detail;
        this.instance = instance;
        this.traceId = traceId;
        this.extensions = extensions == null ? Map.of() : Map.copyOf(extensions);
    }

    public int getStatus() {
        return status;
    }

    public String getType() {
        return type;
    }

    public String getTitle() {
        return title;
    }

    public String getDetail() {
        return detail;
    }

    public String getInstance() {
        return instance;
    }

    @Override
    public String getTraceId() {
        return traceId;
    }

    public Map<String, Object> getExtensions() {
        return extensions;
    }

    private static String buildMessage(int status, String title, String detail) {
        StringBuilder sb = new StringBuilder("ConsentShield API error: status=").append(status);
        if (title != null && !title.isEmpty()) sb.append(" title=").append(title);
        if (detail != null && !detail.isEmpty()) sb.append(" detail=").append(detail);
        return sb.toString();
    }
}
