package com.consentshield.sdk.spring;

import com.consentshield.sdk.ConsentShieldClient;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

class ConsentShieldAutoConfigurationTest {
    private final ApplicationContextRunner ctx = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(ConsentShieldAutoConfiguration.class));

    @Test
    void doesNotActivateWithoutApiKey() {
        ctx.run(c -> assertThat(c).doesNotHaveBean(ConsentShieldClient.class));
    }

    @Test
    void activatesWhenApiKeyPresent() {
        ctx.withPropertyValues("consentshield.api-key=cs_live_abc123")
                .run(c -> {
                    assertThat(c).hasSingleBean(ConsentShieldClient.class);
                    ConsentShieldClient client = c.getBean(ConsentShieldClient.class);
                    assertThat(client.isFailOpen()).isFalse();
                    assertThat(client.getBaseUrl()).isEqualTo("https://api.consentshield.in/v1");
                });
    }

    @Test
    void bindsAllProperties() {
        ctx
                .withPropertyValues(
                        "consentshield.api-key=cs_live_abc123",
                        "consentshield.base-url=https://example.test/v1/",
                        "consentshield.timeout=5s",
                        "consentshield.max-retries=2",
                        "consentshield.fail-open=true")
                .run(c -> {
                    assertThat(c).hasSingleBean(ConsentShieldClient.class);
                    ConsentShieldClient client = c.getBean(ConsentShieldClient.class);
                    assertThat(client.isFailOpen()).isTrue();
                    assertThat(client.getBaseUrl()).isEqualTo("https://example.test/v1");
                });
    }

    @Test
    void propertiesSettersAndGetters() {
        ConsentShieldProperties p = new ConsentShieldProperties();
        p.setApiKey("cs_live_x");
        p.setBaseUrl("https://example.test");
        p.setTimeout(Duration.ofSeconds(7));
        p.setMaxRetries(5);
        p.setFailOpen(true);

        assertThat(p.getApiKey()).isEqualTo("cs_live_x");
        assertThat(p.getBaseUrl()).isEqualTo("https://example.test");
        assertThat(p.getTimeout()).isEqualTo(Duration.ofSeconds(7));
        assertThat(p.getMaxRetries()).isEqualTo(5);
        assertThat(p.isFailOpen()).isTrue();
    }
}
