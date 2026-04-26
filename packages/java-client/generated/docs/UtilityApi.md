# UtilityApi

All URIs are relative to *https://api.consentshield.in/v1*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**ping**](UtilityApi.md#ping) | **GET** /_ping | Canary health-check |


<a id="ping"></a>
# **ping**
> PingResponse ping()

Canary health-check

Returns the resolved context for the authenticated key. Use this to verify your API key is valid, confirm scopes, and check the rate tier before calling data endpoints. 

### Example
```java
// Import classes:
import com.consentshield.sdk.invoker.ApiClient;
import com.consentshield.sdk.invoker.ApiException;
import com.consentshield.sdk.invoker.Configuration;
import com.consentshield.sdk.invoker.auth.*;
import com.consentshield.sdk.invoker.models.*;
import com.consentshield.sdk.api.UtilityApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("https://api.consentshield.in/v1");
    
    // Configure HTTP bearer authorization: bearerAuth
    HttpBearerAuth bearerAuth = (HttpBearerAuth) defaultClient.getAuthentication("bearerAuth");
    bearerAuth.setBearerToken("BEARER TOKEN");

    UtilityApi apiInstance = new UtilityApi(defaultClient);
    try {
      PingResponse result = apiInstance.ping();
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling UtilityApi#ping");
      System.err.println("Status code: " + e.getCode());
      System.err.println("Reason: " + e.getResponseBody());
      System.err.println("Response headers: " + e.getResponseHeaders());
      e.printStackTrace();
    }
  }
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

[**PingResponse**](PingResponse.md)

### Authorization

[bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json, application/problem+json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Key is valid and active. |  -  |
| **401** | Missing, malformed, or invalid API key. |  -  |
| **410** | API key has been revoked. |  -  |
| **429** | Rate limit exceeded. |  * Retry-After - Seconds until the rate-limit window resets. <br>  * X-RateLimit-Limit - Requests allowed per hour for this key&#39;s tier. <br>  |

