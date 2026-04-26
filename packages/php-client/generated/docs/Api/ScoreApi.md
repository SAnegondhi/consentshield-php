# ConsentShield\Client\ScoreApi

All URIs are relative to https://api.consentshield.in/v1, except if the operation defines another base path.

| Method | HTTP request | Description |
| ------------- | ------------- | ------------- |
| [**scoreSelf()**](ScoreApi.md#scoreSelf) | **GET** /score | Current DEPA compliance score for the caller&#39;s org |


## `scoreSelf()`

```php
scoreSelf(): \ConsentShield\Client\Model\DepaScoreResponse
```

Current DEPA compliance score for the caller's org

Reads the cached DEPA score from `public.depa_compliance_metrics` (ADR-0025). Refreshed nightly by pg_cron; `computed_at` shows freshness. All four dimension scores are on a 0..5 scale; `total_score` = sum on a 0..20 scale. `max_score` is a fixed constant (20) to make ratio arithmetic easy. If the nightly refresh has not yet run for this org, every score field is `null`, `computed_at` is `null`, and `max_score` is still `20`. Clients should treat a null `total_score` as \"no data yet\" rather than 0. Requires an org-scoped API key; account-scoped keys get 400.

### Example

```php
<?php
require_once(__DIR__ . '/vendor/autoload.php');


// Configure Bearer (cs_live_<token>) authorization: bearerAuth
$config = ConsentShield\Client\Configuration::getDefaultConfiguration()->setAccessToken('YOUR_ACCESS_TOKEN');


$apiInstance = new ConsentShield\Client\Api\ScoreApi(
    // If you want use custom http client, pass your client which implements `GuzzleHttp\ClientInterface`.
    // This is optional, `GuzzleHttp\Client` will be used as default.
    new GuzzleHttp\Client(),
    $config
);

try {
    $result = $apiInstance->scoreSelf();
    print_r($result);
} catch (Exception $e) {
    echo 'Exception when calling ScoreApi->scoreSelf: ', $e->getMessage(), PHP_EOL;
}
```

### Parameters

This endpoint does not need any parameter.

### Return type

[**\ConsentShield\Client\Model\DepaScoreResponse**](../Model/DepaScoreResponse.md)

### Authorization

[bearerAuth](../../README.md#bearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`, `application/problem+json`

[[Back to top]](#) [[Back to API list]](../../README.md#endpoints)
[[Back to Model list]](../../README.md#models)
[[Back to README]](../../README.md)
