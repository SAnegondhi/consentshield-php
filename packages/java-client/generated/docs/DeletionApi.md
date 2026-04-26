# DeletionApi

All URIs are relative to *https://api.consentshield.in/v1*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**deletionReceiptsList**](DeletionApi.md#deletionReceiptsList) | **GET** /deletion/receipts | List deletion receipts |
| [**deletionTrigger**](DeletionApi.md#deletionTrigger) | **POST** /deletion/trigger | Trigger deletion orchestration for a data principal |
| [**integrationsTestDelete**](DeletionApi.md#integrationsTestDelete) | **POST** /integrations/{connector_id}/test_delete | Exercise a customer deletion-webhook handler without real data |


<a id="deletionReceiptsList"></a>
# **deletionReceiptsList**
> DeletionReceiptsResponse deletionReceiptsList(status, connectorId, artefactId, issuedAfter, issuedBefore, cursor, limit)

List deletion receipts

Cursor-paginated list with filters on status, connector, source artefact_id, and issue date range. 

### Example
```java
// Import classes:
import com.consentshield.sdk.invoker.ApiClient;
import com.consentshield.sdk.invoker.ApiException;
import com.consentshield.sdk.invoker.Configuration;
import com.consentshield.sdk.invoker.auth.*;
import com.consentshield.sdk.invoker.models.*;
import com.consentshield.sdk.api.DeletionApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("https://api.consentshield.in/v1");
    
    // Configure HTTP bearer authorization: bearerAuth
    HttpBearerAuth bearerAuth = (HttpBearerAuth) defaultClient.getAuthentication("bearerAuth");
    bearerAuth.setBearerToken("BEARER TOKEN");

    DeletionApi apiInstance = new DeletionApi(defaultClient);
    String status = "status_example"; // String | 
    UUID connectorId = UUID.randomUUID(); // UUID | 
    String artefactId = "artefactId_example"; // String | 
    OffsetDateTime issuedAfter = OffsetDateTime.now(); // OffsetDateTime | 
    OffsetDateTime issuedBefore = OffsetDateTime.now(); // OffsetDateTime | 
    String cursor = "cursor_example"; // String | 
    Integer limit = 50; // Integer | 
    try {
      DeletionReceiptsResponse result = apiInstance.deletionReceiptsList(status, connectorId, artefactId, issuedAfter, issuedBefore, cursor, limit);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling DeletionApi#deletionReceiptsList");
      System.err.println("Status code: " + e.getCode());
      System.err.println("Reason: " + e.getResponseBody());
      System.err.println("Response headers: " + e.getResponseHeaders());
      e.printStackTrace();
    }
  }
}
```

### Parameters

| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **status** | **String**|  | [optional] |
| **connectorId** | **UUID**|  | [optional] |
| **artefactId** | **String**|  | [optional] |
| **issuedAfter** | **OffsetDateTime**|  | [optional] |
| **issuedBefore** | **OffsetDateTime**|  | [optional] |
| **cursor** | **String**|  | [optional] |
| **limit** | **Integer**|  | [optional] [default to 50] |

### Return type

[**DeletionReceiptsResponse**](DeletionReceiptsResponse.md)

### Authorization

[bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json, application/problem+json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Paged list envelope. |  -  |
| **401** | Missing, malformed, or invalid API key. |  -  |
| **403** | Key is valid but lacks read:deletion scope. |  -  |
| **410** | API key has been revoked. |  -  |
| **422** | Bad cursor, limit, or date. |  -  |
| **429** | Rate limit exceeded. |  * Retry-After - Seconds until the rate-limit window resets. <br>  * X-RateLimit-Limit - Requests allowed per hour for this key&#39;s tier. <br>  |

<a id="deletionTrigger"></a>
# **deletionTrigger**
> DeletionTriggerResponse deletionTrigger(deletionTriggerRequest)

Trigger deletion orchestration for a data principal

Inserts &#x60;artefact_revocations&#x60; rows for every active artefact matching the scope. The ADR-0022 cascade + process-artefact-revocation Edge Function then create &#x60;deletion_receipts&#x60; asynchronously. &#x60;retention_expired&#x60; mode is not yet implemented (returns 501). 

### Example
```java
// Import classes:
import com.consentshield.sdk.invoker.ApiClient;
import com.consentshield.sdk.invoker.ApiException;
import com.consentshield.sdk.invoker.Configuration;
import com.consentshield.sdk.invoker.auth.*;
import com.consentshield.sdk.invoker.models.*;
import com.consentshield.sdk.api.DeletionApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("https://api.consentshield.in/v1");
    
    // Configure HTTP bearer authorization: bearerAuth
    HttpBearerAuth bearerAuth = (HttpBearerAuth) defaultClient.getAuthentication("bearerAuth");
    bearerAuth.setBearerToken("BEARER TOKEN");

    DeletionApi apiInstance = new DeletionApi(defaultClient);
    DeletionTriggerRequest deletionTriggerRequest = new DeletionTriggerRequest(); // DeletionTriggerRequest | 
    try {
      DeletionTriggerResponse result = apiInstance.deletionTrigger(deletionTriggerRequest);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling DeletionApi#deletionTrigger");
      System.err.println("Status code: " + e.getCode());
      System.err.println("Reason: " + e.getResponseBody());
      System.err.println("Response headers: " + e.getResponseHeaders());
      e.printStackTrace();
    }
  }
}
```

### Parameters

| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **deletionTriggerRequest** | [**DeletionTriggerRequest**](DeletionTriggerRequest.md)|  | |

### Return type

[**DeletionTriggerResponse**](DeletionTriggerResponse.md)

### Authorization

[bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json, application/problem+json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **202** | Revocations inserted; deletion_receipts are being created asynchronously. |  -  |
| **401** | Missing, malformed, or invalid API key. |  -  |
| **403** | Key is valid but lacks write:deletion scope. |  -  |
| **404** | property_id does not belong to the key&#39;s org. |  -  |
| **410** | API key has been revoked. |  -  |
| **422** | Invalid body, missing purpose_codes for consent_revoked, or unknown reason/actor_type/identifier. |  -  |
| **429** | Rate limit exceeded. |  * Retry-After - Seconds until the rate-limit window resets. <br>  * X-RateLimit-Limit - Requests allowed per hour for this key&#39;s tier. <br>  |
| **501** | retention_expired mode is not yet implemented. |  -  |

<a id="integrationsTestDelete"></a>
# **integrationsTestDelete**
> TestDeleteResponse integrationsTestDelete(connectorId)

Exercise a customer deletion-webhook handler without real data

Creates a synthetic deletion request against the named connector. Generates a random &#x60;cs_test_principal_&lt;uuid&gt;&#x60; data_principal and writes a &#x60;deletion_receipts&#x60; row with &#x60;trigger_type&#x3D;&#39;test_delete&#39;&#x60; and &#x60;request_payload.is_test&#x3D;true&#x60;. Customer handlers should inspect &#x60;request_payload.reason&#x3D;&#x3D;&#39;test&#39;&#x60; and short-circuit without deleting real data. Rate-limited to 10 calls per connector per hour. Test rows have &#x60;artefact_id&#x3D;null&#x60; so compliance aggregations exclude them. 

### Example
```java
// Import classes:
import com.consentshield.sdk.invoker.ApiClient;
import com.consentshield.sdk.invoker.ApiException;
import com.consentshield.sdk.invoker.Configuration;
import com.consentshield.sdk.invoker.auth.*;
import com.consentshield.sdk.invoker.models.*;
import com.consentshield.sdk.api.DeletionApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("https://api.consentshield.in/v1");
    
    // Configure HTTP bearer authorization: bearerAuth
    HttpBearerAuth bearerAuth = (HttpBearerAuth) defaultClient.getAuthentication("bearerAuth");
    bearerAuth.setBearerToken("BEARER TOKEN");

    DeletionApi apiInstance = new DeletionApi(defaultClient);
    UUID connectorId = UUID.randomUUID(); // UUID | 
    try {
      TestDeleteResponse result = apiInstance.integrationsTestDelete(connectorId);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling DeletionApi#integrationsTestDelete");
      System.err.println("Status code: " + e.getCode());
      System.err.println("Reason: " + e.getResponseBody());
      System.err.println("Response headers: " + e.getResponseHeaders());
      e.printStackTrace();
    }
  }
}
```

### Parameters

| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **connectorId** | **UUID**|  | |

### Return type

[**TestDeleteResponse**](TestDeleteResponse.md)

### Authorization

[bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json, application/problem+json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **202** | Test deletion receipt created; delivery is async. |  -  |
| **401** | Missing, malformed, or invalid API key. |  -  |
| **403** | Key is valid but lacks write:deletion scope or does not authorise the org. |  -  |
| **404** | connector_id does not belong to the key&#39;s org. |  -  |
| **410** | API key has been revoked. |  -  |
| **422** | connector_id malformed or connector is not active. |  -  |
| **429** | Rate limit — 10 test_delete calls per connector per hour. |  -  |

