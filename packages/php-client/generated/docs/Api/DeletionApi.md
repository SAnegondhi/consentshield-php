# ConsentShield\Client\DeletionApi

All URIs are relative to https://api.consentshield.in/v1, except if the operation defines another base path.

| Method | HTTP request | Description |
| ------------- | ------------- | ------------- |
| [**deletionReceiptsList()**](DeletionApi.md#deletionReceiptsList) | **GET** /deletion/receipts | List deletion receipts |
| [**deletionTrigger()**](DeletionApi.md#deletionTrigger) | **POST** /deletion/trigger | Trigger deletion orchestration for a data principal |
| [**integrationsTestDelete()**](DeletionApi.md#integrationsTestDelete) | **POST** /integrations/{connector_id}/test_delete | Exercise a customer deletion-webhook handler without real data |


## `deletionReceiptsList()`

```php
deletionReceiptsList($status, $connector_id, $artefact_id, $issued_after, $issued_before, $cursor, $limit): \ConsentShield\Client\Model\DeletionReceiptsResponse
```

List deletion receipts

Cursor-paginated list with filters on status, connector, source artefact_id, and issue date range.

### Example

```php
<?php
require_once(__DIR__ . '/vendor/autoload.php');


// Configure Bearer (cs_live_<token>) authorization: bearerAuth
$config = ConsentShield\Client\Configuration::getDefaultConfiguration()->setAccessToken('YOUR_ACCESS_TOKEN');


$apiInstance = new ConsentShield\Client\Api\DeletionApi(
    // If you want use custom http client, pass your client which implements `GuzzleHttp\ClientInterface`.
    // This is optional, `GuzzleHttp\Client` will be used as default.
    new GuzzleHttp\Client(),
    $config
);
$status = 'status_example'; // string
$connector_id = 'connector_id_example'; // string
$artefact_id = 'artefact_id_example'; // string
$issued_after = new \DateTime('2013-10-20T19:20:30+01:00'); // \DateTime
$issued_before = new \DateTime('2013-10-20T19:20:30+01:00'); // \DateTime
$cursor = 'cursor_example'; // string
$limit = 50; // int

try {
    $result = $apiInstance->deletionReceiptsList($status, $connector_id, $artefact_id, $issued_after, $issued_before, $cursor, $limit);
    print_r($result);
} catch (Exception $e) {
    echo 'Exception when calling DeletionApi->deletionReceiptsList: ', $e->getMessage(), PHP_EOL;
}
```

### Parameters

| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **status** | **string**|  | [optional] |
| **connector_id** | **string**|  | [optional] |
| **artefact_id** | **string**|  | [optional] |
| **issued_after** | **\DateTime**|  | [optional] |
| **issued_before** | **\DateTime**|  | [optional] |
| **cursor** | **string**|  | [optional] |
| **limit** | **int**|  | [optional] [default to 50] |

### Return type

[**\ConsentShield\Client\Model\DeletionReceiptsResponse**](../Model/DeletionReceiptsResponse.md)

### Authorization

[bearerAuth](../../README.md#bearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`, `application/problem+json`

[[Back to top]](#) [[Back to API list]](../../README.md#endpoints)
[[Back to Model list]](../../README.md#models)
[[Back to README]](../../README.md)

## `deletionTrigger()`

```php
deletionTrigger($deletion_trigger_request): \ConsentShield\Client\Model\DeletionTriggerResponse
```

Trigger deletion orchestration for a data principal

Inserts `artefact_revocations` rows for every active artefact matching the scope. The ADR-0022 cascade + process-artefact-revocation Edge Function then create `deletion_receipts` asynchronously. `retention_expired` mode is not yet implemented (returns 501).

### Example

```php
<?php
require_once(__DIR__ . '/vendor/autoload.php');


// Configure Bearer (cs_live_<token>) authorization: bearerAuth
$config = ConsentShield\Client\Configuration::getDefaultConfiguration()->setAccessToken('YOUR_ACCESS_TOKEN');


$apiInstance = new ConsentShield\Client\Api\DeletionApi(
    // If you want use custom http client, pass your client which implements `GuzzleHttp\ClientInterface`.
    // This is optional, `GuzzleHttp\Client` will be used as default.
    new GuzzleHttp\Client(),
    $config
);
$deletion_trigger_request = {"property_id":"3a4b8b21-5a11-4f37-9b7c-6f2e0d5c8b1a","data_principal_identifier":"alice@example.com","identifier_type":"email","reason":"erasure_request","actor_type":"user","actor_ref":"alice@example.com"}; // \ConsentShield\Client\Model\DeletionTriggerRequest

try {
    $result = $apiInstance->deletionTrigger($deletion_trigger_request);
    print_r($result);
} catch (Exception $e) {
    echo 'Exception when calling DeletionApi->deletionTrigger: ', $e->getMessage(), PHP_EOL;
}
```

### Parameters

| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **deletion_trigger_request** | [**\ConsentShield\Client\Model\DeletionTriggerRequest**](../Model/DeletionTriggerRequest.md)|  | |

### Return type

[**\ConsentShield\Client\Model\DeletionTriggerResponse**](../Model/DeletionTriggerResponse.md)

### Authorization

[bearerAuth](../../README.md#bearerAuth)

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`, `application/problem+json`

[[Back to top]](#) [[Back to API list]](../../README.md#endpoints)
[[Back to Model list]](../../README.md#models)
[[Back to README]](../../README.md)

## `integrationsTestDelete()`

```php
integrationsTestDelete($connector_id): \ConsentShield\Client\Model\TestDeleteResponse
```

Exercise a customer deletion-webhook handler without real data

Creates a synthetic deletion request against the named connector. Generates a random `cs_test_principal_<uuid>` data_principal and writes a `deletion_receipts` row with `trigger_type='test_delete'` and `request_payload.is_test=true`. Customer handlers should inspect `request_payload.reason=='test'` and short-circuit without deleting real data. Rate-limited to 10 calls per connector per hour. Test rows have `artefact_id=null` so compliance aggregations exclude them.

### Example

```php
<?php
require_once(__DIR__ . '/vendor/autoload.php');


// Configure Bearer (cs_live_<token>) authorization: bearerAuth
$config = ConsentShield\Client\Configuration::getDefaultConfiguration()->setAccessToken('YOUR_ACCESS_TOKEN');


$apiInstance = new ConsentShield\Client\Api\DeletionApi(
    // If you want use custom http client, pass your client which implements `GuzzleHttp\ClientInterface`.
    // This is optional, `GuzzleHttp\Client` will be used as default.
    new GuzzleHttp\Client(),
    $config
);
$connector_id = 'connector_id_example'; // string

try {
    $result = $apiInstance->integrationsTestDelete($connector_id);
    print_r($result);
} catch (Exception $e) {
    echo 'Exception when calling DeletionApi->integrationsTestDelete: ', $e->getMessage(), PHP_EOL;
}
```

### Parameters

| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **connector_id** | **string**|  | |

### Return type

[**\ConsentShield\Client\Model\TestDeleteResponse**](../Model/TestDeleteResponse.md)

### Authorization

[bearerAuth](../../README.md#bearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`, `application/problem+json`

[[Back to top]](#) [[Back to API list]](../../README.md#endpoints)
[[Back to Model list]](../../README.md#models)
[[Back to README]](../../README.md)
