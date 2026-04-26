# ConsentShield\Client\RightsApi

All URIs are relative to https://api.consentshield.in/v1, except if the operation defines another base path.

| Method | HTTP request | Description |
| ------------- | ------------- | ------------- |
| [**rightsRequestCreate()**](RightsApi.md#rightsRequestCreate) | **POST** /rights/requests | Create a rights request on behalf of a verified data principal |
| [**rightsRequestList()**](RightsApi.md#rightsRequestList) | **GET** /rights/requests | List rights requests for the caller&#39;s org (cursor-paginated) |


## `rightsRequestCreate()`

```php
rightsRequestCreate($rights_request_create_request): \ConsentShield\Client\Model\RightsRequestCreatedResponse
```

Create a rights request on behalf of a verified data principal

Records a DPDP §11 rights request captured outside the public portal (mobile app, call-centre, branch, kiosk, CRM/helpdesk integration, in-person). Bypasses the portal's Cloudflare Turnstile and email-OTP gate because the API-key holder attests identity via `identity_verified_by` — a free-text attestation describing how identity was verified (e.g. `internal_kyc_check`, `branch_officer_id_42`). The attestation is stored on the row and echoed in a dedicated `created_via_api` audit event for DPB audit filtering. Requires an org-scoped API key; account-scoped keys get 400. The created request starts in `new` status with a 30-day SLA deadline.

### Example

```php
<?php
require_once(__DIR__ . '/vendor/autoload.php');


// Configure Bearer (cs_live_<token>) authorization: bearerAuth
$config = ConsentShield\Client\Configuration::getDefaultConfiguration()->setAccessToken('YOUR_ACCESS_TOKEN');


$apiInstance = new ConsentShield\Client\Api\RightsApi(
    // If you want use custom http client, pass your client which implements `GuzzleHttp\ClientInterface`.
    // This is optional, `GuzzleHttp\Client` will be used as default.
    new GuzzleHttp\Client(),
    $config
);
$rights_request_create_request = {"type":"erasure","requestor_name":"Alice Customer","requestor_email":"alice@example.com","request_details":"Please erase all data associated with my account.","identity_verified_by":"internal_kyc_check","captured_via":"api"}; // \ConsentShield\Client\Model\RightsRequestCreateRequest

try {
    $result = $apiInstance->rightsRequestCreate($rights_request_create_request);
    print_r($result);
} catch (Exception $e) {
    echo 'Exception when calling RightsApi->rightsRequestCreate: ', $e->getMessage(), PHP_EOL;
}
```

### Parameters

| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **rights_request_create_request** | [**\ConsentShield\Client\Model\RightsRequestCreateRequest**](../Model/RightsRequestCreateRequest.md)|  | |

### Return type

[**\ConsentShield\Client\Model\RightsRequestCreatedResponse**](../Model/RightsRequestCreatedResponse.md)

### Authorization

[bearerAuth](../../README.md#bearerAuth)

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`, `application/problem+json`

[[Back to top]](#) [[Back to API list]](../../README.md#endpoints)
[[Back to Model list]](../../README.md#models)
[[Back to README]](../../README.md)

## `rightsRequestList()`

```php
rightsRequestList($status, $request_type, $captured_via, $created_after, $created_before, $cursor, $limit): \ConsentShield\Client\Model\RightsRequestListResponse
```

List rights requests for the caller's org (cursor-paginated)

Returns a keyset-paginated list of rights requests for the caller's org. Includes both portal-initiated and API-initiated requests; filter on `captured_via` to distinguish. `created_by_api_key_id` on each item names the specific API key that created the request (null for portal-initiated). Requires an org-scoped API key; account-scoped keys get 400.

### Example

```php
<?php
require_once(__DIR__ . '/vendor/autoload.php');


// Configure Bearer (cs_live_<token>) authorization: bearerAuth
$config = ConsentShield\Client\Configuration::getDefaultConfiguration()->setAccessToken('YOUR_ACCESS_TOKEN');


$apiInstance = new ConsentShield\Client\Api\RightsApi(
    // If you want use custom http client, pass your client which implements `GuzzleHttp\ClientInterface`.
    // This is optional, `GuzzleHttp\Client` will be used as default.
    new GuzzleHttp\Client(),
    $config
);
$status = 'status_example'; // string
$request_type = 'request_type_example'; // string
$captured_via = 'captured_via_example'; // string
$created_after = new \DateTime('2013-10-20T19:20:30+01:00'); // \DateTime
$created_before = new \DateTime('2013-10-20T19:20:30+01:00'); // \DateTime
$cursor = 'cursor_example'; // string
$limit = 50; // int

try {
    $result = $apiInstance->rightsRequestList($status, $request_type, $captured_via, $created_after, $created_before, $cursor, $limit);
    print_r($result);
} catch (Exception $e) {
    echo 'Exception when calling RightsApi->rightsRequestList: ', $e->getMessage(), PHP_EOL;
}
```

### Parameters

| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **status** | **string**|  | [optional] |
| **request_type** | **string**|  | [optional] |
| **captured_via** | **string**|  | [optional] |
| **created_after** | **\DateTime**|  | [optional] |
| **created_before** | **\DateTime**|  | [optional] |
| **cursor** | **string**|  | [optional] |
| **limit** | **int**|  | [optional] [default to 50] |

### Return type

[**\ConsentShield\Client\Model\RightsRequestListResponse**](../Model/RightsRequestListResponse.md)

### Authorization

[bearerAuth](../../README.md#bearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`, `application/problem+json`

[[Back to top]](#) [[Back to API list]](../../README.md#endpoints)
[[Back to Model list]](../../README.md#models)
[[Back to README]](../../README.md)
