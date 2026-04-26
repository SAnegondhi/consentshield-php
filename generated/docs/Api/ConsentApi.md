# ConsentShield\Client\ConsentApi

All URIs are relative to https://api.consentshield.in/v1, except if the operation defines another base path.

| Method | HTTP request | Description |
| ------------- | ------------- | ------------- |
| [**consentArtefactGet()**](ConsentApi.md#consentArtefactGet) | **GET** /consent/artefacts/{id} | Get a single consent artefact |
| [**consentArtefactRevoke()**](ConsentApi.md#consentArtefactRevoke) | **POST** /consent/artefacts/{id}/revoke | Revoke a consent artefact |
| [**consentArtefactsList()**](ConsentApi.md#consentArtefactsList) | **GET** /consent/artefacts | List consent artefacts (cursor-paginated) |
| [**consentEventsList()**](ConsentApi.md#consentEventsList) | **GET** /consent/events | List consent events (summary only, cursor-paginated) |
| [**consentRecord()**](ConsentApi.md#consentRecord) | **POST** /consent/record | Mode B server-to-server consent capture |
| [**consentVerify()**](ConsentApi.md#consentVerify) | **GET** /consent/verify | Single-identifier consent verification |
| [**consentVerifyBatch()**](ConsentApi.md#consentVerifyBatch) | **POST** /consent/verify/batch | Batched consent verification |


## `consentArtefactGet()`

```php
consentArtefactGet($id): \ConsentShield\Client\Model\ArtefactDetail
```

Get a single consent artefact

Returns the artefact envelope + revocation record (if any) + full replacement chain in chronological order.

### Example

```php
<?php
require_once(__DIR__ . '/vendor/autoload.php');


// Configure Bearer (cs_live_<token>) authorization: bearerAuth
$config = ConsentShield\Client\Configuration::getDefaultConfiguration()->setAccessToken('YOUR_ACCESS_TOKEN');


$apiInstance = new ConsentShield\Client\Api\ConsentApi(
    // If you want use custom http client, pass your client which implements `GuzzleHttp\ClientInterface`.
    // This is optional, `GuzzleHttp\Client` will be used as default.
    new GuzzleHttp\Client(),
    $config
);
$id = 'id_example'; // string

try {
    $result = $apiInstance->consentArtefactGet($id);
    print_r($result);
} catch (Exception $e) {
    echo 'Exception when calling ConsentApi->consentArtefactGet: ', $e->getMessage(), PHP_EOL;
}
```

### Parameters

| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **id** | **string**|  | |

### Return type

[**\ConsentShield\Client\Model\ArtefactDetail**](../Model/ArtefactDetail.md)

### Authorization

[bearerAuth](../../README.md#bearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`, `application/problem+json`

[[Back to top]](#) [[Back to API list]](../../README.md#endpoints)
[[Back to Model list]](../../README.md#models)
[[Back to README]](../../README.md)

## `consentArtefactRevoke()`

```php
consentArtefactRevoke($id, $revoke_request): \ConsentShield\Client\Model\RevokeResponse
```

Revoke a consent artefact

Records a revocation event for the artefact. The ADR-0022 cascade trigger flips consent_artefacts.status to `revoked` and updates the consent_artefact_index. Idempotent — calling revoke on an already- revoked artefact returns 200 with the existing revocation_record_id. Terminal states (`expired`, `replaced`) cannot be revoked and return 409.

### Example

```php
<?php
require_once(__DIR__ . '/vendor/autoload.php');


// Configure Bearer (cs_live_<token>) authorization: bearerAuth
$config = ConsentShield\Client\Configuration::getDefaultConfiguration()->setAccessToken('YOUR_ACCESS_TOKEN');


$apiInstance = new ConsentShield\Client\Api\ConsentApi(
    // If you want use custom http client, pass your client which implements `GuzzleHttp\ClientInterface`.
    // This is optional, `GuzzleHttp\Client` will be used as default.
    new GuzzleHttp\Client(),
    $config
);
$id = 'id_example'; // string
$revoke_request = {"reason_code":"user_withdrawal","reason_notes":"User requested unsubscribe via email","actor_type":"user","actor_ref":"alice@example.com"}; // \ConsentShield\Client\Model\RevokeRequest

try {
    $result = $apiInstance->consentArtefactRevoke($id, $revoke_request);
    print_r($result);
} catch (Exception $e) {
    echo 'Exception when calling ConsentApi->consentArtefactRevoke: ', $e->getMessage(), PHP_EOL;
}
```

### Parameters

| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **id** | **string**|  | |
| **revoke_request** | [**\ConsentShield\Client\Model\RevokeRequest**](../Model/RevokeRequest.md)|  | |

### Return type

[**\ConsentShield\Client\Model\RevokeResponse**](../Model/RevokeResponse.md)

### Authorization

[bearerAuth](../../README.md#bearerAuth)

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`, `application/problem+json`

[[Back to top]](#) [[Back to API list]](../../README.md#endpoints)
[[Back to Model list]](../../README.md#models)
[[Back to README]](../../README.md)

## `consentArtefactsList()`

```php
consentArtefactsList($property_id, $data_principal_identifier, $identifier_type, $status, $purpose_code, $expires_before, $expires_after, $cursor, $limit): \ConsentShield\Client\Model\ArtefactListResponse
```

List consent artefacts (cursor-paginated)

Returns artefacts for the key's org with keyset pagination and optional filters. `data_principal_identifier` + `identifier_type` must be supplied together to filter by identity.

### Example

```php
<?php
require_once(__DIR__ . '/vendor/autoload.php');


// Configure Bearer (cs_live_<token>) authorization: bearerAuth
$config = ConsentShield\Client\Configuration::getDefaultConfiguration()->setAccessToken('YOUR_ACCESS_TOKEN');


$apiInstance = new ConsentShield\Client\Api\ConsentApi(
    // If you want use custom http client, pass your client which implements `GuzzleHttp\ClientInterface`.
    // This is optional, `GuzzleHttp\Client` will be used as default.
    new GuzzleHttp\Client(),
    $config
);
$property_id = 'property_id_example'; // string
$data_principal_identifier = 'data_principal_identifier_example'; // string
$identifier_type = 'identifier_type_example'; // string
$status = 'status_example'; // string
$purpose_code = 'purpose_code_example'; // string
$expires_before = new \DateTime('2013-10-20T19:20:30+01:00'); // \DateTime
$expires_after = new \DateTime('2013-10-20T19:20:30+01:00'); // \DateTime
$cursor = 'cursor_example'; // string
$limit = 50; // int

try {
    $result = $apiInstance->consentArtefactsList($property_id, $data_principal_identifier, $identifier_type, $status, $purpose_code, $expires_before, $expires_after, $cursor, $limit);
    print_r($result);
} catch (Exception $e) {
    echo 'Exception when calling ConsentApi->consentArtefactsList: ', $e->getMessage(), PHP_EOL;
}
```

### Parameters

| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **property_id** | **string**|  | [optional] |
| **data_principal_identifier** | **string**|  | [optional] |
| **identifier_type** | **string**|  | [optional] |
| **status** | **string**|  | [optional] |
| **purpose_code** | **string**|  | [optional] |
| **expires_before** | **\DateTime**|  | [optional] |
| **expires_after** | **\DateTime**|  | [optional] |
| **cursor** | **string**|  | [optional] |
| **limit** | **int**|  | [optional] [default to 50] |

### Return type

[**\ConsentShield\Client\Model\ArtefactListResponse**](../Model/ArtefactListResponse.md)

### Authorization

[bearerAuth](../../README.md#bearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`, `application/problem+json`

[[Back to top]](#) [[Back to API list]](../../README.md#endpoints)
[[Back to Model list]](../../README.md#models)
[[Back to README]](../../README.md)

## `consentEventsList()`

```php
consentEventsList($property_id, $created_after, $created_before, $source, $cursor, $limit): \ConsentShield\Client\Model\EventListResponse
```

List consent events (summary only, cursor-paginated)

Returns paginated summaries (counts, not full payloads) of consent_events rows. Use for §11 audit timelines.

### Example

```php
<?php
require_once(__DIR__ . '/vendor/autoload.php');


// Configure Bearer (cs_live_<token>) authorization: bearerAuth
$config = ConsentShield\Client\Configuration::getDefaultConfiguration()->setAccessToken('YOUR_ACCESS_TOKEN');


$apiInstance = new ConsentShield\Client\Api\ConsentApi(
    // If you want use custom http client, pass your client which implements `GuzzleHttp\ClientInterface`.
    // This is optional, `GuzzleHttp\Client` will be used as default.
    new GuzzleHttp\Client(),
    $config
);
$property_id = 'property_id_example'; // string
$created_after = new \DateTime('2013-10-20T19:20:30+01:00'); // \DateTime
$created_before = new \DateTime('2013-10-20T19:20:30+01:00'); // \DateTime
$source = 'source_example'; // string
$cursor = 'cursor_example'; // string
$limit = 50; // int

try {
    $result = $apiInstance->consentEventsList($property_id, $created_after, $created_before, $source, $cursor, $limit);
    print_r($result);
} catch (Exception $e) {
    echo 'Exception when calling ConsentApi->consentEventsList: ', $e->getMessage(), PHP_EOL;
}
```

### Parameters

| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **property_id** | **string**|  | [optional] |
| **created_after** | **\DateTime**|  | [optional] |
| **created_before** | **\DateTime**|  | [optional] |
| **source** | **string**|  | [optional] |
| **cursor** | **string**|  | [optional] |
| **limit** | **int**|  | [optional] [default to 50] |

### Return type

[**\ConsentShield\Client\Model\EventListResponse**](../Model/EventListResponse.md)

### Authorization

[bearerAuth](../../README.md#bearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`, `application/problem+json`

[[Back to top]](#) [[Back to API list]](../../README.md#endpoints)
[[Back to Model list]](../../README.md#models)
[[Back to README]](../../README.md)

## `consentRecord()`

```php
consentRecord($record_request): \ConsentShield\Client\Model\RecordResponse
```

Mode B server-to-server consent capture

Records a consent event captured outside the browser (mobile app, call-centre, branch, kiosk, in-person) and issues one artefact per granted purpose. Use client_request_id for safe retries.

### Example

```php
<?php
require_once(__DIR__ . '/vendor/autoload.php');


// Configure Bearer (cs_live_<token>) authorization: bearerAuth
$config = ConsentShield\Client\Configuration::getDefaultConfiguration()->setAccessToken('YOUR_ACCESS_TOKEN');


$apiInstance = new ConsentShield\Client\Api\ConsentApi(
    // If you want use custom http client, pass your client which implements `GuzzleHttp\ClientInterface`.
    // This is optional, `GuzzleHttp\Client` will be used as default.
    new GuzzleHttp\Client(),
    $config
);
$record_request = {"property_id":"3a4b8b21-5a11-4f37-9b7c-6f2e0d5c8b1a","data_principal_identifier":"alice@example.com","identifier_type":"email","purpose_definition_ids":["7f4b3b21-5a11-4f37-9b7c-6f2e0d5c8b1a","9e2c8a0c-1d8a-4a2c-a4bf-2b0e6b1f3c9d"],"captured_at":"2026-04-21T10:14:55Z","client_request_id":"req_01J5TZ8XQKVPKPYH7PZCTMFMH8"}; // \ConsentShield\Client\Model\RecordRequest

try {
    $result = $apiInstance->consentRecord($record_request);
    print_r($result);
} catch (Exception $e) {
    echo 'Exception when calling ConsentApi->consentRecord: ', $e->getMessage(), PHP_EOL;
}
```

### Parameters

| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **record_request** | [**\ConsentShield\Client\Model\RecordRequest**](../Model/RecordRequest.md)|  | |

### Return type

[**\ConsentShield\Client\Model\RecordResponse**](../Model/RecordResponse.md)

### Authorization

[bearerAuth](../../README.md#bearerAuth)

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`, `application/problem+json`

[[Back to top]](#) [[Back to API list]](../../README.md#endpoints)
[[Back to Model list]](../../README.md#models)
[[Back to README]](../../README.md)

## `consentVerify()`

```php
consentVerify($property_id, $data_principal_identifier, $identifier_type, $purpose_code): \ConsentShield\Client\Model\VerifyResponse
```

Single-identifier consent verification

DPDP §6 runtime check. Given a data principal identifier, property, and purpose code, returns whether consent is currently granted, revoked, expired, or never recorded. Identifier is hashed server-side with the org's per-org salt — plaintext is never stored.

### Example

```php
<?php
require_once(__DIR__ . '/vendor/autoload.php');


// Configure Bearer (cs_live_<token>) authorization: bearerAuth
$config = ConsentShield\Client\Configuration::getDefaultConfiguration()->setAccessToken('YOUR_ACCESS_TOKEN');


$apiInstance = new ConsentShield\Client\Api\ConsentApi(
    // If you want use custom http client, pass your client which implements `GuzzleHttp\ClientInterface`.
    // This is optional, `GuzzleHttp\Client` will be used as default.
    new GuzzleHttp\Client(),
    $config
);
$property_id = 'property_id_example'; // string
$data_principal_identifier = 'data_principal_identifier_example'; // string | Caller's identifier for the data principal (email, phone, PAN, etc.). Hashed server-side; never stored.
$identifier_type = 'identifier_type_example'; // string | Determines normalisation rule: email=trim+lowercase; phone/aadhaar=digits only; pan=trim+uppercase; custom=trim. Callers MUST use the same type at record-time and verify-time.
$purpose_code = 'purpose_code_example'; // string

try {
    $result = $apiInstance->consentVerify($property_id, $data_principal_identifier, $identifier_type, $purpose_code);
    print_r($result);
} catch (Exception $e) {
    echo 'Exception when calling ConsentApi->consentVerify: ', $e->getMessage(), PHP_EOL;
}
```

### Parameters

| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **property_id** | **string**|  | |
| **data_principal_identifier** | **string**| Caller&#39;s identifier for the data principal (email, phone, PAN, etc.). Hashed server-side; never stored. | |
| **identifier_type** | **string**| Determines normalisation rule: email&#x3D;trim+lowercase; phone/aadhaar&#x3D;digits only; pan&#x3D;trim+uppercase; custom&#x3D;trim. Callers MUST use the same type at record-time and verify-time. | |
| **purpose_code** | **string**|  | |

### Return type

[**\ConsentShield\Client\Model\VerifyResponse**](../Model/VerifyResponse.md)

### Authorization

[bearerAuth](../../README.md#bearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`, `application/problem+json`

[[Back to top]](#) [[Back to API list]](../../README.md#endpoints)
[[Back to Model list]](../../README.md#models)
[[Back to README]](../../README.md)

## `consentVerifyBatch()`

```php
consentVerifyBatch($verify_batch_request): \ConsentShield\Client\Model\VerifyBatchResponse
```

Batched consent verification

Same semantics as GET /consent/verify but accepts up to 10,000 identifiers in a single call, all sharing the same property_id, identifier_type, and purpose_code. Response preserves input order. All-or-nothing: if any identifier fails normalisation (empty / unknown type), the entire call returns 422.

### Example

```php
<?php
require_once(__DIR__ . '/vendor/autoload.php');


// Configure Bearer (cs_live_<token>) authorization: bearerAuth
$config = ConsentShield\Client\Configuration::getDefaultConfiguration()->setAccessToken('YOUR_ACCESS_TOKEN');


$apiInstance = new ConsentShield\Client\Api\ConsentApi(
    // If you want use custom http client, pass your client which implements `GuzzleHttp\ClientInterface`.
    // This is optional, `GuzzleHttp\Client` will be used as default.
    new GuzzleHttp\Client(),
    $config
);
$verify_batch_request = {"property_id":"3a4b8b21-5a11-4f37-9b7c-6f2e0d5c8b1a","identifier_type":"email","purpose_code":"marketing","identifiers":["alice@example.com","bob@example.com","carol@example.com"]}; // \ConsentShield\Client\Model\VerifyBatchRequest

try {
    $result = $apiInstance->consentVerifyBatch($verify_batch_request);
    print_r($result);
} catch (Exception $e) {
    echo 'Exception when calling ConsentApi->consentVerifyBatch: ', $e->getMessage(), PHP_EOL;
}
```

### Parameters

| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **verify_batch_request** | [**\ConsentShield\Client\Model\VerifyBatchRequest**](../Model/VerifyBatchRequest.md)|  | |

### Return type

[**\ConsentShield\Client\Model\VerifyBatchResponse**](../Model/VerifyBatchResponse.md)

### Authorization

[bearerAuth](../../README.md#bearerAuth)

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`, `application/problem+json`

[[Back to top]](#) [[Back to API list]](../../README.md#endpoints)
[[Back to Model list]](../../README.md#models)
[[Back to README]](../../README.md)
