package com.consentshield.examples;

import com.consentshield.sdk.ConsentShieldClient;
import com.consentshield.sdk.ConsentShieldApiException;
import com.consentshield.sdk.api.UtilityApi;
import com.consentshield.sdk.invoker.ApiException;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * Demonstrates using the auto-configured {@link ConsentShieldClient} bean to
 * gate a marketing endpoint. Outcome contract:
 *
 * <ul>
 *   <li>Granted -> 202 Accepted</li>
 *   <li>Not granted -> 451 Unavailable for Legal Reasons</li>
 *   <li>4xx from upstream (bad property / bad key) -> 502 Bad Gateway</li>
 *   <li>Fail-CLOSED on 5xx / network / timeout -> 503 Service Unavailable</li>
 * </ul>
 */
@SpringBootApplication
public class MarketingGateApplication {
    public static void main(String[] args) {
        SpringApplication.run(MarketingGateApplication.class, args);
    }

    @RestController
    public static class Gate {
        private final ConsentShieldClient client;
        private final UtilityApi utility;

        public Gate(ConsentShieldClient client) {
            this.client = client;
            this.utility = new UtilityApi(client.api());
        }

        @GetMapping("/health")
        public ResponseEntity<Map<String, Object>> health() {
            try {
                utility.ping();
                return ResponseEntity.ok(Map.of("ok", true));
            } catch (ApiException e) {
                return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                        .body(Map.of("ok", false, "status", e.getCode()));
            }
        }

        @PostMapping("/api/marketing/send")
        public ResponseEntity<Map<String, Object>> send(
                @RequestParam("propertyId") String propertyId,
                @RequestBody Map<String, String> body) {
            // Sketch of the gating shape. Replace with the verify call against
            // ConsentApi once the example is wired against the live API. The
            // outcome contract (502 / 503 / 451 / 202) is what's load-bearing
            // here; the actual call site is straightforward.
            try {
                utility.ping();
                return ResponseEntity.accepted().body(Map.of("queued", true));
            } catch (ConsentShieldApiException e) {
                return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                        .body(Map.of("error", "consentshield_api", "detail", e.getDetail()));
            } catch (RuntimeException e) {
                if (client.isFailOpen()) {
                    return ResponseEntity.accepted().body(Map.of("queued", true, "open", true));
                }
                return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                        .body(Map.of("error", "consent_check_failed"));
            }
        }
    }
}
