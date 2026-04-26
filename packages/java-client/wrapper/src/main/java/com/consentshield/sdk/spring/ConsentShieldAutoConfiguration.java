package com.consentshield.sdk.spring;

import com.consentshield.sdk.ConsentShieldClient;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;

/**
 * Spring Boot auto-configuration for {@link ConsentShieldClient}.
 *
 * <p>Activates when:
 * <ul>
 *   <li>{@code consentshield.api-key} is present (i.e. the property exists,
 *       regardless of value), so the bean is only wired in apps that have
 *       opted in.</li>
 *   <li>No other {@link ConsentShieldClient} bean is already defined.</li>
 * </ul>
 *
 * <p>The bean is built via {@link ConsentShieldClient.Builder} from the
 * {@link ConsentShieldProperties} values.
 */
@AutoConfiguration
@ConditionalOnProperty(prefix = "consentshield", name = "api-key")
@EnableConfigurationProperties(ConsentShieldProperties.class)
public class ConsentShieldAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public ConsentShieldClient consentShieldClient(ConsentShieldProperties props) {
        return ConsentShieldClient.builder()
                .apiKey(props.getApiKey())
                .baseUrl(props.getBaseUrl())
                .timeout(props.getTimeout())
                .maxRetries(props.getMaxRetries())
                .failOpen(props.isFailOpen())
                .build();
    }
}
