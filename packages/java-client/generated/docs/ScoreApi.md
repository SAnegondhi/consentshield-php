# ScoreApi

All URIs are relative to *https://api.consentshield.in/v1*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**scoreSelf**](ScoreApi.md#scoreSelf) | **GET** /score | Current DEPA compliance score for the caller&#39;s org |


<a id="scoreSelf"></a>
# **scoreSelf**
> DepaScoreResponse scoreSelf()

Current DEPA compliance score for the caller&#39;s org

Reads the cached DEPA score from &#x60;public.depa_compliance_metrics&#x60; (ADR-0025). Refreshed nightly by pg_cron; &#x60;computed_at&#x60; shows freshness. All four dimension scores are on a 0..5 scale; &#x60;total_score&#x60; &#x3D; sum on a 0..20 scale. &#x60;max_score&#x60; is a fixed constant (20) to make ratio arithmetic easy. If the nightly refresh has not yet run for this org, every score field is &#x60;null&#x60;, &#x60;computed_at&#x60; is &#x60;null&#x60;, and &#x60;max_score&#x60; is still &#x60;20&#x60;. Clients should treat a null &#x60;total_score&#x60; as \&quot;no data yet\&quot; rather than 0. Requires an org-scoped API key; account-scoped keys get 400. 

### Example
```java
// Import classes:
import com.consentshield.sdk.invoker.ApiClient;
import com.consentshield.sdk.invoker.ApiException;
import com.consentshield.sdk.invoker.Configuration;
import com.consentshield.sdk.invoker.auth.*;
import com.consentshield.sdk.invoker.models.*;
import com.consentshield.sdk.api.ScoreApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("https://api.consentshield.in/v1");
    
    // Configure HTTP bearer authorization: bearerAuth
    HttpBearerAuth bearerAuth = (HttpBearerAuth) defaultClient.getAuthentication("bearerAuth");
    bearerAuth.setBearerToken("BEARER TOKEN");

    ScoreApi apiInstance = new ScoreApi(defaultClient);
    try {
      DepaScoreResponse result = apiInstance.scoreSelf();
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling ScoreApi#scoreSelf");
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

[**DepaScoreResponse**](DepaScoreResponse.md)

### Authorization

[bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json, application/problem+json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Current score envelope. |  -  |
| **400** | API key is account-scoped; this endpoint requires an org-scoped key. |  -  |
| **401** | Missing, malformed, or invalid API key. |  -  |
| **403** | Missing &#x60;read:score&#x60; scope, or API key is not authorised for this organisation. |  -  |
| **410** | API key has been revoked. |  -  |
| **429** | Rate limit exceeded. |  * Retry-After - Seconds until the rate-limit window resets. <br>  * X-RateLimit-Limit - Requests allowed per hour for this key&#39;s tier. <br>  |

