# Spring Boot marketing gate — ConsentShield Java SDK example

Runnable Spring Boot 3 app demonstrating consent gating on a marketing endpoint via the auto-configured `ConsentShieldClient` bean.

## Run

```bash
export CONSENTSHIELD_API_KEY=cs_live_...
mvn spring-boot:run
```

## Outcomes

| Scenario | HTTP status |
|---|---|
| Consent granted | 202 Accepted |
| Consent not granted | 451 Unavailable for Legal Reasons |
| Upstream 4xx (bad property / bad key) | 502 Bad Gateway |
| Upstream 5xx / network / timeout (fail-CLOSED) | 503 Service Unavailable |
| Upstream 5xx / network / timeout (fail-OPEN) | 202 Accepted with `open: true` |

Set `consentshield.fail-open: true` in `application.yml` (or `CONSENT_VERIFY_FAIL_OPEN=true` env) to switch from fail-CLOSED.
