# ConsentShield\Client\SecurityApi

All URIs are relative to https://api.consentshield.in/v1, except if the operation defines another base path.

| Method | HTTP request | Description |
| ------------- | ------------- | ------------- |
| [**securityScansList()**](SecurityApi.md#securityScansList) | **GET** /security/scans | List recent security-posture scan findings |


## `securityScansList()`

```php
securityScansList($property_id, $severity, $signal_key, $scanned_after, $scanned_before, $cursor, $limit): \ConsentShield\Client\Model\SecurityScanListResponse
```

List recent security-posture scan findings

Keyset-paginated view of `public.security_scans`. **The table is a transient buffer** — rows are delivered to the customer's R2/S3 and deleted within ~5 minutes. This endpoint serves only the recent window. Populated nightly by the `run-security-scans` Edge Function (ADR-0015); one row per finding per property, plus an `all_clean` row with `severity=info` for trend tracking. Requires an org-scoped API key; account-scoped keys get 400.

### Example

```php
<?php
require_once(__DIR__ . '/vendor/autoload.php');


// Configure Bearer (cs_live_<token>) authorization: bearerAuth
$config = ConsentShield\Client\Configuration::getDefaultConfiguration()->setAccessToken('YOUR_ACCESS_TOKEN');


$apiInstance = new ConsentShield\Client\Api\SecurityApi(
    // If you want use custom http client, pass your client which implements `GuzzleHttp\ClientInterface`.
    // This is optional, `GuzzleHttp\Client` will be used as default.
    new GuzzleHttp\Client(),
    $config
);
$property_id = 'property_id_example'; // string
$severity = 'severity_example'; // string
$signal_key = 'signal_key_example'; // string | e.g. `missing_csp`, `missing_hsts`, `tls_invalid`, `all_clean`.
$scanned_after = new \DateTime('2013-10-20T19:20:30+01:00'); // \DateTime
$scanned_before = new \DateTime('2013-10-20T19:20:30+01:00'); // \DateTime
$cursor = 'cursor_example'; // string
$limit = 50; // int

try {
    $result = $apiInstance->securityScansList($property_id, $severity, $signal_key, $scanned_after, $scanned_before, $cursor, $limit);
    print_r($result);
} catch (Exception $e) {
    echo 'Exception when calling SecurityApi->securityScansList: ', $e->getMessage(), PHP_EOL;
}
```

### Parameters

| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **property_id** | **string**|  | [optional] |
| **severity** | **string**|  | [optional] |
| **signal_key** | **string**| e.g. &#x60;missing_csp&#x60;, &#x60;missing_hsts&#x60;, &#x60;tls_invalid&#x60;, &#x60;all_clean&#x60;. | [optional] |
| **scanned_after** | **\DateTime**|  | [optional] |
| **scanned_before** | **\DateTime**|  | [optional] |
| **cursor** | **string**|  | [optional] |
| **limit** | **int**|  | [optional] [default to 50] |

### Return type

[**\ConsentShield\Client\Model\SecurityScanListResponse**](../Model/SecurityScanListResponse.md)

### Authorization

[bearerAuth](../../README.md#bearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`, `application/problem+json`

[[Back to top]](#) [[Back to API list]](../../README.md#endpoints)
[[Back to Model list]](../../README.md#models)
[[Back to README]](../../README.md)
