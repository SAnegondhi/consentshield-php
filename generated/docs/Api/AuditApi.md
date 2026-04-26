# ConsentShield\Client\AuditApi

All URIs are relative to https://api.consentshield.in/v1, except if the operation defines another base path.

| Method | HTTP request | Description |
| ------------- | ------------- | ------------- |
| [**auditList()**](AuditApi.md#auditList) | **GET** /audit | List recent audit_log events for the caller&#39;s org |


## `auditList()`

```php
auditList($event_type, $entity_type, $created_after, $created_before, $cursor, $limit): \ConsentShield\Client\Model\AuditLogListResponse
```

List recent audit_log events for the caller's org

Keyset-paginated view of `public.audit_log`. **The table is a transient buffer** — rows are delivered to the customer's R2/S3 and deleted within ~5 minutes. This endpoint therefore serves only the undelivered + recently-delivered window (useful for real-time ops dashboards and SIEM polling). The canonical historical audit lives in the customer's own storage. `ip_address` is deliberately excluded from the response envelope (PII). Correlate via `actor_email` if per-person attribution is needed. Requires an org-scoped API key; account-scoped keys get 400.

### Example

```php
<?php
require_once(__DIR__ . '/vendor/autoload.php');


// Configure Bearer (cs_live_<token>) authorization: bearerAuth
$config = ConsentShield\Client\Configuration::getDefaultConfiguration()->setAccessToken('YOUR_ACCESS_TOKEN');


$apiInstance = new ConsentShield\Client\Api\AuditApi(
    // If you want use custom http client, pass your client which implements `GuzzleHttp\ClientInterface`.
    // This is optional, `GuzzleHttp\Client` will be used as default.
    new GuzzleHttp\Client(),
    $config
);
$event_type = 'event_type_example'; // string | Filter by exact event_type (e.g. `banner_published`, `purpose_created`).
$entity_type = 'entity_type_example'; // string | Filter by exact entity_type (e.g. `banner`, `purpose`, `property`).
$created_after = new \DateTime('2013-10-20T19:20:30+01:00'); // \DateTime
$created_before = new \DateTime('2013-10-20T19:20:30+01:00'); // \DateTime
$cursor = 'cursor_example'; // string
$limit = 50; // int

try {
    $result = $apiInstance->auditList($event_type, $entity_type, $created_after, $created_before, $cursor, $limit);
    print_r($result);
} catch (Exception $e) {
    echo 'Exception when calling AuditApi->auditList: ', $e->getMessage(), PHP_EOL;
}
```

### Parameters

| Name | Type | Description  | Notes |
| ------------- | ------------- | ------------- | ------------- |
| **event_type** | **string**| Filter by exact event_type (e.g. &#x60;banner_published&#x60;, &#x60;purpose_created&#x60;). | [optional] |
| **entity_type** | **string**| Filter by exact entity_type (e.g. &#x60;banner&#x60;, &#x60;purpose&#x60;, &#x60;property&#x60;). | [optional] |
| **created_after** | **\DateTime**|  | [optional] |
| **created_before** | **\DateTime**|  | [optional] |
| **cursor** | **string**|  | [optional] |
| **limit** | **int**|  | [optional] [default to 50] |

### Return type

[**\ConsentShield\Client\Model\AuditLogListResponse**](../Model/AuditLogListResponse.md)

### Authorization

[bearerAuth](../../README.md#bearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`, `application/problem+json`

[[Back to top]](#) [[Back to API list]](../../README.md#endpoints)
[[Back to Model list]](../../README.md#models)
[[Back to README]](../../README.md)
