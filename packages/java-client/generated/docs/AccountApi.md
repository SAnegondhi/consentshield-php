# AccountApi

All URIs are relative to *https://api.consentshield.in/v1*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**keySelf**](AccountApi.md#keySelf) | **GET** /keys/self | Introspect the Bearer token&#39;s own metadata |
| [**planList**](AccountApi.md#planList) | **GET** /plans | List active plans with tier limits + pricing |
| [**propertyList**](AccountApi.md#propertyList) | **GET** /properties | List web properties configured for the caller&#39;s org |
| [**purposeList**](AccountApi.md#purposeList) | **GET** /purposes | List purposes configured for the caller&#39;s org |
| [**usage**](AccountApi.md#usage) | **GET** /usage | Per-day request count + latency for the Bearer token |


<a id="keySelf"></a>
# **keySelf**
> KeySelfResponse keySelf()

Introspect the Bearer token&#39;s own metadata

Returns the public metadata of the API key presented as the Bearer token. Useful for SDK setup wizards (confirm scopes) and health checks. No scope gate — any valid Bearer can introspect itself. 

### Example
```java
// Import classes:
import com.consentshield.sdk.invoker.ApiClient;
import com.consentshield.sdk.invoker.ApiException;
import com.consentshield.sdk.invoker.Configuration;
import com.consentshield.sdk.invoker.auth.*;
import com.consentshield.sdk.invoker.models.*;
import com.consentshield.sdk.api.AccountApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("https://api.consentshield.in/v1");
    
    // Configure HTTP bearer authorization: bearerAuth
    HttpBearerAuth bearerAuth = (HttpBearerAuth) defaultClient.getAuthentication("bearerAuth");
    bearerAuth.setBearerToken("BEARER TOKEN");

    AccountApi apiInstance = new AccountApi(defaultClient);
    try {
      KeySelfResponse result = apiInstance.keySelf();
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling AccountApi#keySelf");
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

[**KeySelfResponse**](KeySelfResponse.md)

### Authorization

[bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json, application/problem+json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Key metadata. |  -  |
| **401** | Missing, malformed, or invalid API key. |  -  |
| **410** | API key has been revoked. |  -  |
| **429** | Rate limit exceeded. |  * Retry-After - Seconds until the rate-limit window resets. <br>  * X-RateLimit-Limit - Requests allowed per hour for this key&#39;s tier. <br>  |

<a id="planList"></a>
# **planList**
> PlanListResponse planList()

List active plans with tier limits + pricing

Public tier table. Useful for SDK setup wizards (\&quot;which plan am I on?\&quot;), checkout flows, and per-tier feature lists. No scope gate — any valid Bearer can call. The &#x60;razorpay_plan_id&#x60; field is deliberately NOT in the response — it&#39;s an internal integration key for the Razorpay subscription service. 

### Example
```java
// Import classes:
import com.consentshield.sdk.invoker.ApiClient;
import com.consentshield.sdk.invoker.ApiException;
import com.consentshield.sdk.invoker.Configuration;
import com.consentshield.sdk.invoker.auth.*;
import com.consentshield.sdk.invoker.models.*;
import com.consentshield.sdk.api.AccountApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("https://api.consentshield.in/v1");
    
    // Configure HTTP bearer authorization: bearerAuth
    HttpBearerAuth bearerAuth = (HttpBearerAuth) defaultClient.getAuthentication("bearerAuth");
    bearerAuth.setBearerToken("BEARER TOKEN");

    AccountApi apiInstance = new AccountApi(defaultClient);
    try {
      PlanListResponse result = apiInstance.planList();
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling AccountApi#planList");
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

[**PlanListResponse**](PlanListResponse.md)

### Authorization

[bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json, application/problem+json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Active plans, cheapest first. |  -  |
| **401** | Missing, malformed, or invalid API key. |  -  |
| **410** | API key has been revoked. |  -  |
| **429** | Rate limit exceeded. |  * Retry-After - Seconds until the rate-limit window resets. <br>  * X-RateLimit-Limit - Requests allowed per hour for this key&#39;s tier. <br>  |

<a id="propertyList"></a>
# **propertyList**
> PropertyListResponse propertyList()

List web properties configured for the caller&#39;s org

Returns every &#x60;web_properties&#x60; row for the caller&#39;s org. &#x60;property_id&#x60; values used throughout &#x60;/v1/consent/_*&#x60; come from here. The HMAC &#x60;event_signing_secret&#x60; is **not** in the response — it&#39;s a server-only key used by the Cloudflare Worker to verify inbound events. Requires an org-scoped API key; account-scoped keys get 400. 

### Example
```java
// Import classes:
import com.consentshield.sdk.invoker.ApiClient;
import com.consentshield.sdk.invoker.ApiException;
import com.consentshield.sdk.invoker.Configuration;
import com.consentshield.sdk.invoker.auth.*;
import com.consentshield.sdk.invoker.models.*;
import com.consentshield.sdk.api.AccountApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("https://api.consentshield.in/v1");
    
    // Configure HTTP bearer authorization: bearerAuth
    HttpBearerAuth bearerAuth = (HttpBearerAuth) defaultClient.getAuthentication("bearerAuth");
    bearerAuth.setBearerToken("BEARER TOKEN");

    AccountApi apiInstance = new AccountApi(defaultClient);
    try {
      PropertyListResponse result = apiInstance.propertyList();
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling AccountApi#propertyList");
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

[**PropertyListResponse**](PropertyListResponse.md)

### Authorization

[bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json, application/problem+json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Web properties for the caller&#39;s org. |  -  |
| **400** | API key is account-scoped; this endpoint requires an org-scoped key. |  -  |
| **401** | Missing, malformed, or invalid API key. |  -  |
| **403** | Missing &#x60;read:consent&#x60; scope, or API key is not authorised for this organisation. |  -  |
| **410** | API key has been revoked. |  -  |
| **429** | Rate limit exceeded. |  * Retry-After - Seconds until the rate-limit window resets. <br>  * X-RateLimit-Limit - Requests allowed per hour for this key&#39;s tier. <br>  |

<a id="purposeList"></a>
# **purposeList**
> PurposeListResponse purposeList()

List purposes configured for the caller&#39;s org

Returns every &#x60;purpose_definitions&#x60; row for the caller&#39;s org. &#x60;/v1/consent/verify&#x60; and &#x60;/v1/consent/record&#x60; both require a valid &#x60;purpose_code&#x60; or &#x60;purpose_definition_id&#x60; from this list. Requires an org-scoped API key; account-scoped keys get 400. 

### Example
```java
// Import classes:
import com.consentshield.sdk.invoker.ApiClient;
import com.consentshield.sdk.invoker.ApiException;
import com.consentshield.sdk.invoker.Configuration;
import com.consentshield.sdk.invoker.auth.*;
import com.consentshield.sdk.invoker.models.*;
import com.consentshield.sdk.api.AccountApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("https://api.consentshield.in/v1");
    
    // Configure HTTP bearer authorization: bearerAuth
    HttpBearerAuth bearerAuth = (HttpBearerAuth) defaultClient.getAuthentication("bearerAuth");
    bearerAuth.setBearerToken("BEARER TOKEN");

    AccountApi apiInstance = new AccountApi(defaultClient);
    try {
      PurposeListResponse result = apiInstance.purposeList();
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling AccountApi#purposeList");
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

[**PurposeListResponse**](PurposeListResponse.md)

### Authorization

[bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json, application/problem+json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Purposes for the caller&#39;s org. |  -  |
| **400** | API key is account-scoped; this endpoint requires an org-scoped key. |  -  |
| **401** | Missing, malformed, or invalid API key. |  -  |
| **403** | Missing &#x60;read:consent&#x60; scope, or API key is not authorised for this organisation. |  -  |
| **410** | API key has been revoked. |  -  |
| **429** | Rate limit exceeded. |  * Retry-After - Seconds until the rate-limit window resets. <br>  * X-RateLimit-Limit - Requests allowed per hour for this key&#39;s tier. <br>  |

<a id="usage"></a>
# **usage**
> UsageResponse usage(days)

Per-day request count + latency for the Bearer token

Returns a day-by-day usage series for the presenting API key over the last &#x60;days&#x60; days (default 7, min 1, max 30). Zero-filled for days with no activity. Most recent day first. 

### Example
```java
// Import classes:
import com.consentshield.sdk.invoker.ApiClient;
import com.consentshield.sdk.invoker.ApiException;
import com.consentshield.sdk.invoker.Configuration;
import com.consentshield.sdk.invoker.auth.*;
import com.consentshield.sdk.invoker.models.*;
import com.consentshield.sdk.api.AccountApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("https://api.consentshield.in/v1");
    
    // Configure HTTP bearer authorization: bearerAuth
    HttpBearerAuth bearerAuth = (HttpBearerAuth) defaultClient.getAuthentication("bearerAuth");
    bearerAuth.setBearerToken("BEARER TOKEN");

    AccountApi apiInstance = new AccountApi(defaultClient);
    Integer days = 7; // Integer | 
    try {
      UsageResponse result = apiInstance.usage(days);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling AccountApi#usage");
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
| **days** | **Integer**|  | [optional] [default to 7] |

### Return type

[**UsageResponse**](UsageResponse.md)

### Authorization

[bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json, application/problem+json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Usage series. |  -  |
| **401** | Missing, malformed, or invalid API key. |  -  |
| **410** | API key has been revoked. |  -  |
| **422** | days out of range (must be 1..30). |  -  |
| **429** | Rate limit exceeded. |  * Retry-After - Seconds until the rate-limit window resets. <br>  * X-RateLimit-Limit - Requests allowed per hour for this key&#39;s tier. <br>  |

