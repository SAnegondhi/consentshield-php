# SecurityApi

All URIs are relative to *https://api.consentshield.in/v1*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**securityScansList**](SecurityApi.md#securityScansList) | **GET** /security/scans | List recent security-posture scan findings |


<a id="securityScansList"></a>
# **securityScansList**
> SecurityScanListResponse securityScansList(propertyId, severity, signalKey, scannedAfter, scannedBefore, cursor, limit)

List recent security-posture scan findings

Keyset-paginated view of &#x60;public.security_scans&#x60;. **The table is a transient buffer** — rows are delivered to the customer&#39;s R2/S3 and deleted within ~5 minutes. This endpoint serves only the recent window. Populated nightly by the &#x60;run-security-scans&#x60; Edge Function (ADR-0015); one row per finding per property, plus an &#x60;all_clean&#x60; row with &#x60;severity&#x3D;info&#x60; for trend tracking. Requires an org-scoped API key; account-scoped keys get 400. 

### Example
```java
// Import classes:
import com.consentshield.sdk.invoker.ApiClient;
import com.consentshield.sdk.invoker.ApiException;
import com.consentshield.sdk.invoker.Configuration;
import com.consentshield.sdk.invoker.auth.*;
import com.consentshield.sdk.invoker.models.*;
import com.consentshield.sdk.api.SecurityApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("https://api.consentshield.in/v1");
    
    // Configure HTTP bearer authorization: bearerAuth
    HttpBearerAuth bearerAuth = (HttpBearerAuth) defaultClient.getAuthentication("bearerAuth");
    bearerAuth.setBearerToken("BEARER TOKEN");

    SecurityApi apiInstance = new SecurityApi(defaultClient);
    UUID propertyId = UUID.randomUUID(); // UUID | 
    String severity = "critical"; // String | 
    String signalKey = "signalKey_example"; // String | e.g. `missing_csp`, `missing_hsts`, `tls_invalid`, `all_clean`.
    OffsetDateTime scannedAfter = OffsetDateTime.now(); // OffsetDateTime | 
    OffsetDateTime scannedBefore = OffsetDateTime.now(); // OffsetDateTime | 
    String cursor = "cursor_example"; // String | 
    Integer limit = 50; // Integer | 
    try {
      SecurityScanListResponse result = apiInstance.securityScansList(propertyId, severity, signalKey, scannedAfter, scannedBefore, cursor, limit);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling SecurityApi#securityScansList");
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
| **propertyId** | **UUID**|  | [optional] |
| **severity** | **String**|  | [optional] [enum: critical, high, medium, low, info] |
| **signalKey** | **String**| e.g. &#x60;missing_csp&#x60;, &#x60;missing_hsts&#x60;, &#x60;tls_invalid&#x60;, &#x60;all_clean&#x60;. | [optional] |
| **scannedAfter** | **OffsetDateTime**|  | [optional] |
| **scannedBefore** | **OffsetDateTime**|  | [optional] |
| **cursor** | **String**|  | [optional] |
| **limit** | **Integer**|  | [optional] [default to 50] |

### Return type

[**SecurityScanListResponse**](SecurityScanListResponse.md)

### Authorization

[bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json, application/problem+json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Paged security-scan list. |  -  |
| **400** | API key is account-scoped; this endpoint requires an org-scoped key. |  -  |
| **401** | Missing, malformed, or invalid API key. |  -  |
| **403** | Missing &#x60;read:security&#x60; scope, or API key is not authorised for this organisation. |  -  |
| **410** | API key has been revoked. |  -  |
| **422** | Bad cursor, limit, date, or severity. |  -  |
| **429** | Rate limit exceeded. |  * Retry-After - Seconds until the rate-limit window resets. <br>  * X-RateLimit-Limit - Requests allowed per hour for this key&#39;s tier. <br>  |

