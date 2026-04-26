# ConsentShield\Client\AccountApi

All URIs are relative to https://api.consentshield.in/v1, except if the operation defines another base path.

| Method | HTTP request | Description |
| ------------- | ------------- | ------------- |
| [**keySelf()**](AccountApi.md#keySelf) | **GET** /keys/self | Introspect the Bearer token&#39;s own metadata |
| [**planList()**](AccountApi.md#planList) | **GET** /plans | List active plans with tier limits + pricing |
| [**propertyList()**](AccountApi.md#propertyList) | **GET** /properties | List web properties configured for the caller&#39;s org |
| [**purposeList()**](AccountApi.md#purposeList) | **GET** /purposes | List purposes configured for the caller&#39;s org |
| [**usage()**](AccountApi.md#usage) | **GET** /usage | Per-day request count + latency for the Bearer token |


## `keySelf()`

```php
keySelf(): \ConsentShield\Client\Model\KeySelfResponse
```

Introspect the Bearer token's own metadata

Returns the public metadata of the API key presented as the Bearer token. Useful for SDK setup wizards (confirm scopes) and health checks. No scope gate — any valid Bearer can introspect itself.

### Example

```php
<?php
require_once(__DIR__ . '/vendor/autoload.php');


// Configure Bearer (cs_live_<token>) authorization: bearerAuth
$config = ConsentShield\Client\Configuration::getDefaultConfiguration()->setAccessToken('YOUR_ACCESS_TOKEN');


$apiInstance = new ConsentShield\Client\Api\AccountApi(
    // If you want use custom http client, pass your client which implements `GuzzleHttp\ClientInterface`.
    // This is optional, `GuzzleHttp\Client` will be used as default.
    new GuzzleHttp\Client(),
    $config
);

try {
    $result = $apiInstance->keySelf();
    print_r($result);
} catch (Exception $e) {
    echo 'Exception when calling AccountApi->keySelf: ', $e->getMessage(), PHP_EOL;
}
```

### Parameters

This endpoint does not need any parameter.

### Return type

[**\ConsentShield\Client\Model\KeySelfResponse**](../Model/KeySelfResponse.md)

### Authorization

[bearerAuth](../../README.md#bearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`, `application/problem+json`

[[Back to top]](#) [[Back to API list]](../../README.md#endpoints)
[[Back to Model list]](../../README.md#models)
[[Back to README]](../../README.md)

## `planList()`

```php
planList(): \ConsentShield\Client\Model\PlanListResponse
```

List active plans with tier limits + pricing

Public tier table. Useful for SDK setup wizards (\"which plan am I on?\"), checkout flows, and per-tier feature lists. No scope gate — any valid Bearer can call. The `razorpay_plan_id` field is deliberately NOT in the response — it's an internal integration key for the Razorpay subscription service.

### Example

```php
<?php
require_once(__DIR__ . '/vendor/autoload.php');


// Configure Bearer (cs_live_<token>) authorization: bearerAuth
$config = ConsentShield\Client\Configuration::getDefaultConfiguration()->setAccessToken('YOUR_ACCESS_TOKEN');


$apiInstance = new ConsentShield\Client\Api\AccountApi(
    // If you want use custom http client, pass your client which implements `GuzzleHttp\ClientInterface`.
    // This is optional, `GuzzleHttp\Client` will be used as default.
    new GuzzleHttp\Client(),
    $config
);

try {
    $result = $apiInstance->planList();
    print_r($result);
} catch (Exception $e) {
    echo 'Exception when calling AccountApi->planList: ', $e->getMessage(), PHP_EOL;
}
```

### Parameters

This endpoint does not need any parameter.

### Return type

[**\ConsentShield\Client\Model\PlanListResponse**](../Model/PlanListResponse.md)

### Authorization

[bearerAuth](../../README.md#bearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`, `application/problem+json`

[[Back to top]](#) [[Back to API list]](../../README.md#endpoints)
[[Back to Model list]](../../README.md#models)
[[Back to README]](../../README.md)

## `propertyList()`

```php
propertyList(): \ConsentShield\Client\Model\PropertyListResponse
```

List web properties configured for the caller's org

Returns every `web_properties` row for the caller's org. `property_id` values used throughout `/v1/consent/_*` come from here. The HMAC `event_signing_secret` is **not** in the response — it's a server-only key used by the Cloudflare Worker to verify inbound events. Requires an org-scoped API key; account-scoped keys get 400.

### Example

```php
<?php
require_once(__DIR__ . '/vendor/autoload.php');


// Configure Bearer (cs_live_<token>) authorization: bearerAuth
$config = ConsentShield\Client\Configuration::getDefaultConfiguration()->setAccessToken('YOUR_ACCESS_TOKEN');


$apiInstance = new ConsentShield\Client\Api\AccountApi(
    // If you want use custom http client, pass your client which implements `GuzzleHttp\ClientInterface`.
    // This is optional, `GuzzleHttp\Client` will be used as default.
    new GuzzleHttp\Client(),
    $config
);

try {
    $result = $apiInstance->propertyList();
    print_r($result);
} catch (Exception $e) {
    echo 'Exception when calling AccountApi->propertyList: ', $e->getMessage(), PHP_EOL;
}
```

### Parameters

This endpoint does not need any parameter.

### Return type

[**\ConsentShield\Client\Model\PropertyListResponse**](../Model/PropertyListResponse.md)

### Authorization

[bearerAuth](../../README.md#bearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`, `application/problem+json`

[[Back to top]](#) [[Back to API list]](../../README.md#endpoints)
[[Back to Model list]](../../README.md#models)
[[Back to README]](../../README.md)

## `purposeList()`

```php
purposeList(): \ConsentShield\Client\Model\PurposeListResponse
```

List purposes configured for the caller's org

Returns every `purpose_definitions` row for the caller's org. `/v1/consent/verify` and `/v1/consent/record` both require a valid `purpose_code` or `purpose_definition_id` from this list. Requires an org-scoped API key; account-scoped keys get 400.

### Example

```php
<?php
require_once(__DIR__ . '/vendor/autoload.php');


// Configure Bearer (cs_live_<token>) authorization: bearerAuth
$config = ConsentShield\Client\Configuration::getDefaultConfiguration()->setAccessToken('YOUR_ACCESS_TOKEN');


$apiInstance = new ConsentShield\Client\Api\AccountApi(
    // If you want use custom http client, pass your client which implements `GuzzleHttp\ClientInterface`.
    // This is optional, `GuzzleHttp\Client` will be used as default.
    new GuzzleHttp\Client(),
    $config
);

try {
    $result = $apiInstance->purposeList();
    print_r($result);
} catch (Exception $e) {
    echo 'Exception when calling AccountApi->purposeList: ', $e->getMessage(), PHP_EOL;
}
```

### Parameters

This endpoint does not need any parameter.

### Return type

[**\ConsentShield\Client\Model\PurposeListResponse**](../Model/PurposeListResponse.md)

### Authorization

[bearerAuth](../../README.md#bearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`, `application/problem+json`

[[Back to top]](#) [[Back to API list]](../../README.md#endpoints)
[[Back to Model list]](../../README.md#models)
[[Back to README]](../../README.md)

## `usage()`

```php
usage($days): \ConsentShield\Client\Model\UsageResponse
```

Per-day request count + latency for the Bearer token

Returns a day-by-day usage series for the presenting API key over the last `days` days (default 7, min 1, max 30). Zero-filled for days with no activity. Most recent day first.

### Example

```php
<?php
require_once(__DIR__ . '/vendor/autoload.php');


// Configure Bearer (cs_live_<token>) authorization: bearerAuth
$config = ConsentShield\Client\Configuration::getDefaultConfiguration()->setAccessToken('YOUR_ACCESS_TOKEN');


$apiInstance = new ConsentShield\Client\Api\AccountApi(
    // If you want use custom http client, pass your client which implements `GuzzleHttp\ClientInterface`.
    // This is optional, `GuzzleHttp\Client` will be used as default.
    new GuzzleHttp\Client(),
    $config
);
$days = 7; // int

try {
    $result = $apiInstance->usage($days);
    print_r($result);
} catch (Exception $e) {
    echo 'Exception when calling AccountApi->usage: ', $e->getMessage(), PHP_EOL;
}
```

### Parameters

| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **days** | **int**|  | [optional] [default to 7] |

### Return type

[**\ConsentShield\Client\Model\UsageResponse**](../Model/UsageResponse.md)

### Authorization

[bearerAuth](../../README.md#bearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`, `application/problem+json`

[[Back to top]](#) [[Back to API list]](../../README.md#endpoints)
[[Back to Model list]](../../README.md#models)
[[Back to README]](../../README.md)
