# RightsApi

All URIs are relative to *https://api.consentshield.in/v1*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**rightsRequestCreate**](RightsApi.md#rightsRequestCreate) | **POST** /rights/requests | Create a rights request on behalf of a verified data principal |
| [**rightsRequestList**](RightsApi.md#rightsRequestList) | **GET** /rights/requests | List rights requests for the caller&#39;s org (cursor-paginated) |


<a id="rightsRequestCreate"></a>
# **rightsRequestCreate**
> RightsRequestCreatedResponse rightsRequestCreate(rightsRequestCreateRequest)

Create a rights request on behalf of a verified data principal

Records a DPDP §11 rights request captured outside the public portal (mobile app, call-centre, branch, kiosk, CRM/helpdesk integration, in-person). Bypasses the portal&#39;s Cloudflare Turnstile and email-OTP gate because the API-key holder attests identity via &#x60;identity_verified_by&#x60; — a free-text attestation describing how identity was verified (e.g. &#x60;internal_kyc_check&#x60;, &#x60;branch_officer_id_42&#x60;). The attestation is stored on the row and echoed in a dedicated &#x60;created_via_api&#x60; audit event for DPB audit filtering. Requires an org-scoped API key; account-scoped keys get 400. The created request starts in &#x60;new&#x60; status with a 30-day SLA deadline. 

### Example
```java
// Import classes:
import com.consentshield.sdk.invoker.ApiClient;
import com.consentshield.sdk.invoker.ApiException;
import com.consentshield.sdk.invoker.Configuration;
import com.consentshield.sdk.invoker.auth.*;
import com.consentshield.sdk.invoker.models.*;
import com.consentshield.sdk.api.RightsApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("https://api.consentshield.in/v1");
    
    // Configure HTTP bearer authorization: bearerAuth
    HttpBearerAuth bearerAuth = (HttpBearerAuth) defaultClient.getAuthentication("bearerAuth");
    bearerAuth.setBearerToken("BEARER TOKEN");

    RightsApi apiInstance = new RightsApi(defaultClient);
    RightsRequestCreateRequest rightsRequestCreateRequest = new RightsRequestCreateRequest(); // RightsRequestCreateRequest | 
    try {
      RightsRequestCreatedResponse result = apiInstance.rightsRequestCreate(rightsRequestCreateRequest);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling RightsApi#rightsRequestCreate");
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
| **rightsRequestCreateRequest** | [**RightsRequestCreateRequest**](RightsRequestCreateRequest.md)|  | |

### Return type

[**RightsRequestCreatedResponse**](RightsRequestCreatedResponse.md)

### Authorization

[bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json, application/problem+json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** | Rights request created. |  -  |
| **400** | API key is account-scoped; this endpoint requires an org-scoped key. |  -  |
| **401** | Missing, malformed, or invalid API key. |  -  |
| **403** | Missing &#x60;write:rights&#x60; scope, or API key is not authorised for this organisation. |  -  |
| **410** | API key has been revoked. |  -  |
| **422** | Missing/invalid field, malformed email, or unknown type/captured_via. |  -  |
| **429** | Rate limit exceeded. |  * Retry-After - Seconds until the rate-limit window resets. <br>  * X-RateLimit-Limit - Requests allowed per hour for this key&#39;s tier. <br>  |

<a id="rightsRequestList"></a>
# **rightsRequestList**
> RightsRequestListResponse rightsRequestList(status, requestType, capturedVia, createdAfter, createdBefore, cursor, limit)

List rights requests for the caller&#39;s org (cursor-paginated)

Returns a keyset-paginated list of rights requests for the caller&#39;s org. Includes both portal-initiated and API-initiated requests; filter on &#x60;captured_via&#x60; to distinguish. &#x60;created_by_api_key_id&#x60; on each item names the specific API key that created the request (null for portal-initiated). Requires an org-scoped API key; account-scoped keys get 400. 

### Example
```java
// Import classes:
import com.consentshield.sdk.invoker.ApiClient;
import com.consentshield.sdk.invoker.ApiException;
import com.consentshield.sdk.invoker.Configuration;
import com.consentshield.sdk.invoker.auth.*;
import com.consentshield.sdk.invoker.models.*;
import com.consentshield.sdk.api.RightsApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("https://api.consentshield.in/v1");
    
    // Configure HTTP bearer authorization: bearerAuth
    HttpBearerAuth bearerAuth = (HttpBearerAuth) defaultClient.getAuthentication("bearerAuth");
    bearerAuth.setBearerToken("BEARER TOKEN");

    RightsApi apiInstance = new RightsApi(defaultClient);
    String status = "new"; // String | 
    String requestType = "erasure"; // String | 
    String capturedVia = "portal"; // String | 
    OffsetDateTime createdAfter = OffsetDateTime.now(); // OffsetDateTime | 
    OffsetDateTime createdBefore = OffsetDateTime.now(); // OffsetDateTime | 
    String cursor = "cursor_example"; // String | 
    Integer limit = 50; // Integer | 
    try {
      RightsRequestListResponse result = apiInstance.rightsRequestList(status, requestType, capturedVia, createdAfter, createdBefore, cursor, limit);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling RightsApi#rightsRequestList");
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
| **status** | **String**|  | [optional] [enum: new, in_progress, completed, rejected] |
| **requestType** | **String**|  | [optional] [enum: erasure, access, correction, nomination] |
| **capturedVia** | **String**|  | [optional] [enum: portal, api, kiosk, branch, call_center, mobile_app, email, other] |
| **createdAfter** | **OffsetDateTime**|  | [optional] |
| **createdBefore** | **OffsetDateTime**|  | [optional] |
| **cursor** | **String**|  | [optional] |
| **limit** | **Integer**|  | [optional] [default to 50] |

### Return type

[**RightsRequestListResponse**](RightsRequestListResponse.md)

### Authorization

[bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json, application/problem+json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Paged list envelope. |  -  |
| **400** | API key is account-scoped; this endpoint requires an org-scoped key. |  -  |
| **401** | Missing, malformed, or invalid API key. |  -  |
| **403** | Missing &#x60;read:rights&#x60; scope, or API key is not authorised for this organisation. |  -  |
| **410** | API key has been revoked. |  -  |
| **422** | Bad cursor, limit, date, or enum value. |  -  |
| **429** | Rate limit exceeded. |  * Retry-After - Seconds until the rate-limit window resets. <br>  * X-RateLimit-Limit - Requests allowed per hour for this key&#39;s tier. <br>  |

