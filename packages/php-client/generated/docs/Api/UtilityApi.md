# ConsentShield\Client\UtilityApi

All URIs are relative to https://api.consentshield.in/v1, except if the operation defines another base path.

| Method | HTTP request | Description |
| ------------- | ------------- | ------------- |
| [**ping()**](UtilityApi.md#ping) | **GET** /_ping | Canary health-check |


## `ping()`

```php
ping(): \ConsentShield\Client\Model\PingResponse
```

Canary health-check

Returns the resolved context for the authenticated key. Use this to verify your API key is valid, confirm scopes, and check the rate tier before calling data endpoints.

### Example

```php
<?php
require_once(__DIR__ . '/vendor/autoload.php');


// Configure Bearer (cs_live_<token>) authorization: bearerAuth
$config = ConsentShield\Client\Configuration::getDefaultConfiguration()->setAccessToken('YOUR_ACCESS_TOKEN');


$apiInstance = new ConsentShield\Client\Api\UtilityApi(
    // If you want use custom http client, pass your client which implements `GuzzleHttp\ClientInterface`.
    // This is optional, `GuzzleHttp\Client` will be used as default.
    new GuzzleHttp\Client(),
    $config
);

try {
    $result = $apiInstance->ping();
    print_r($result);
} catch (Exception $e) {
    echo 'Exception when calling UtilityApi->ping: ', $e->getMessage(), PHP_EOL;
}
```

### Parameters

This endpoint does not need any parameter.

### Return type

[**\ConsentShield\Client\Model\PingResponse**](../Model/PingResponse.md)

### Authorization

[bearerAuth](../../README.md#bearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`, `application/problem+json`

[[Back to top]](#) [[Back to API list]](../../README.md#endpoints)
[[Back to Model list]](../../README.md#models)
[[Back to README]](../../README.md)
