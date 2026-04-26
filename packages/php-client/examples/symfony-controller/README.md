# Symfony controller — ConsentShield PHP SDK example

Drop `MarketingController.php` into `src/Controller/`. Then in `config/services.yaml`:

```yaml
services:
    ConsentShield\Sdk\ConsentShieldClient:
        factory: ['ConsentShield\Sdk\ConsentShieldClient', 'create']
        arguments:
            - '%env(CONSENTSHIELD_API_KEY)%'
```

```bash
composer require consentshield/sdk:^1.0
export CONSENTSHIELD_API_KEY=cs_live_...
symfony server:start
```

## Outcomes

| Scenario | HTTP status |
|---|---|
| Consent granted | 202 Accepted |
| Upstream 4xx | 502 Bad Gateway |
| Upstream 5xx / network / timeout (fail-CLOSED) | 503 Service Unavailable |
| Upstream 5xx / network / timeout (fail-OPEN) | 202 with `open: true` |
