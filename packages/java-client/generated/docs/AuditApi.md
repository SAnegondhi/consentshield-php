# AuditApi

All URIs are relative to *https://api.consentshield.in/v1*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**auditList**](AuditApi.md#auditList) | **GET** /audit | List recent audit_log events for the caller&#39;s org |


<a id="auditList"></a>
# **auditList**
> AuditLogListResponse auditList(eventType, entityType, createdAfter, createdBefore, cursor, limit)

List recent audit_log events for the caller&#39;s org

Keyset-paginated view of &#x60;public.audit_log&#x60;. **The table is a transient buffer** — rows are delivered to the customer&#39;s R2/S3 and deleted within ~5 minutes. This endpoint therefore serves only the undelivered + recently-delivered window (useful for real-time ops dashboards and SIEM polling). The canonical historical audit lives in the customer&#39;s own storage. &#x60;ip_address&#x60; is deliberately excluded from the response envelope (PII). Correlate via &#x60;actor_email&#x60; if per-person attribution is needed. Requires an org-scoped API key; account-scoped keys get 400. 

### Example
```java
// Import classes:
import com.consentshield.sdk.invoker.ApiClient;
import com.consentshield.sdk.invoker.ApiException;
import com.consentshield.sdk.invoker.Configuration;
import com.consentshield.sdk.invoker.auth.*;
import com.consentshield.sdk.invoker.models.*;
import com.consentshield.sdk.api.AuditApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("https://api.consentshield.in/v1");
    
    // Configure HTTP bearer authorization: bearerAuth
    HttpBearerAuth bearerAuth = (HttpBearerAuth) defaultClient.getAuthentication("bearerAuth");
    bearerAuth.setBearerToken("BEARER TOKEN");

    AuditApi apiInstance = new AuditApi(defaultClient);
    String eventType = "eventType_example"; // String | Filter by exact event_type (e.g. `banner_published`, `purpose_created`).
    String entityType = "entityType_example"; // String | Filter by exact entity_type (e.g. `banner`, `purpose`, `property`).
    OffsetDateTime createdAfter = OffsetDateTime.now(); // OffsetDateTime | 
    OffsetDateTime createdBefore = OffsetDateTime.now(); // OffsetDateTime | 
    String cursor = "cursor_example"; // String | 
    Integer limit = 50; // Integer | 
    try {
      AuditLogListResponse result = apiInstance.auditList(eventType, entityType, createdAfter, createdBefore, cursor, limit);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling AuditApi#auditList");
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
| **eventType** | **String**| Filter by exact event_type (e.g. &#x60;banner_published&#x60;, &#x60;purpose_created&#x60;). | [optional] |
| **entityType** | **String**| Filter by exact entity_type (e.g. &#x60;banner&#x60;, &#x60;purpose&#x60;, &#x60;property&#x60;). | [optional] |
| **createdAfter** | **OffsetDateTime**|  | [optional] |
| **createdBefore** | **OffsetDateTime**|  | [optional] |
| **cursor** | **String**|  | [optional] |
| **limit** | **Integer**|  | [optional] [default to 50] |

### Return type

[**AuditLogListResponse**](AuditLogListResponse.md)

### Authorization

[bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json, application/problem+json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Paged audit list. |  -  |
| **400** | API key is account-scoped; this endpoint requires an org-scoped key. |  -  |
| **401** | Missing, malformed, or invalid API key. |  -  |
| **403** | Missing &#x60;read:audit&#x60; scope, or API key is not authorised for this organisation. |  -  |
| **410** | API key has been revoked. |  -  |
| **422** | Bad cursor, limit, or date. |  -  |
| **429** | Rate limit exceeded. |  * Retry-After - Seconds until the rate-limit window resets. <br>  * X-RateLimit-Limit - Requests allowed per hour for this key&#39;s tier. <br>  |

