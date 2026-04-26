# ConsentShield.Client.Api.AccountApi

All URIs are relative to *https://api.consentshield.in/v1*

| Method | HTTP request | Description |
|--------|--------------|-------------|
| [**KeySelf**](AccountApi.md#keyself) | **GET** /keys/self | Introspect the Bearer token&#39;s own metadata |
| [**PlanList**](AccountApi.md#planlist) | **GET** /plans | List active plans with tier limits + pricing |
| [**PropertyList**](AccountApi.md#propertylist) | **GET** /properties | List web properties configured for the caller&#39;s org |
| [**PurposeList**](AccountApi.md#purposelist) | **GET** /purposes | List purposes configured for the caller&#39;s org |
| [**Usage**](AccountApi.md#usage) | **GET** /usage | Per-day request count + latency for the Bearer token |

<a id="keyself"></a>
# **KeySelf**
> KeySelfResponse KeySelf ()

Introspect the Bearer token's own metadata

Returns the public metadata of the API key presented as the Bearer token. Useful for SDK setup wizards (confirm scopes) and health checks. No scope gate — any valid Bearer can introspect itself. 

### Example
```csharp
using System.Collections.Generic;
using System.Diagnostics;
using System.Net.Http;
using ConsentShield.Client.Api;
using ConsentShield.Client.Client;
using ConsentShield.Client.Model;

namespace Example
{
    public class KeySelfExample
    {
        public static void Main()
        {
            Configuration config = new Configuration();
            config.BasePath = "https://api.consentshield.in/v1";
            // Configure Bearer token for authorization: bearerAuth
            config.AccessToken = "YOUR_BEARER_TOKEN";

            // create instances of HttpClient, HttpClientHandler to be reused later with different Api classes
            HttpClient httpClient = new HttpClient();
            HttpClientHandler httpClientHandler = new HttpClientHandler();
            var apiInstance = new AccountApi(httpClient, config, httpClientHandler);

            try
            {
                // Introspect the Bearer token's own metadata
                KeySelfResponse result = apiInstance.KeySelf();
                Debug.WriteLine(result);
            }
            catch (ApiException  e)
            {
                Debug.Print("Exception when calling AccountApi.KeySelf: " + e.Message);
                Debug.Print("Status Code: " + e.ErrorCode);
                Debug.Print(e.StackTrace);
            }
        }
    }
}
```

#### Using the KeySelfWithHttpInfo variant
This returns an ApiResponse object which contains the response data, status code and headers.

```csharp
try
{
    // Introspect the Bearer token's own metadata
    ApiResponse<KeySelfResponse> response = apiInstance.KeySelfWithHttpInfo();
    Debug.Write("Status Code: " + response.StatusCode);
    Debug.Write("Response Headers: " + response.Headers);
    Debug.Write("Response Body: " + response.Data);
}
catch (ApiException e)
{
    Debug.Print("Exception when calling AccountApi.KeySelfWithHttpInfo: " + e.Message);
    Debug.Print("Status Code: " + e.ErrorCode);
    Debug.Print(e.StackTrace);
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

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

<a id="planlist"></a>
# **PlanList**
> PlanListResponse PlanList ()

List active plans with tier limits + pricing

Public tier table. Useful for SDK setup wizards (\"which plan am I on?\"), checkout flows, and per-tier feature lists. No scope gate — any valid Bearer can call. The `razorpay_plan_id` field is deliberately NOT in the response — it's an internal integration key for the Razorpay subscription service. 

### Example
```csharp
using System.Collections.Generic;
using System.Diagnostics;
using System.Net.Http;
using ConsentShield.Client.Api;
using ConsentShield.Client.Client;
using ConsentShield.Client.Model;

namespace Example
{
    public class PlanListExample
    {
        public static void Main()
        {
            Configuration config = new Configuration();
            config.BasePath = "https://api.consentshield.in/v1";
            // Configure Bearer token for authorization: bearerAuth
            config.AccessToken = "YOUR_BEARER_TOKEN";

            // create instances of HttpClient, HttpClientHandler to be reused later with different Api classes
            HttpClient httpClient = new HttpClient();
            HttpClientHandler httpClientHandler = new HttpClientHandler();
            var apiInstance = new AccountApi(httpClient, config, httpClientHandler);

            try
            {
                // List active plans with tier limits + pricing
                PlanListResponse result = apiInstance.PlanList();
                Debug.WriteLine(result);
            }
            catch (ApiException  e)
            {
                Debug.Print("Exception when calling AccountApi.PlanList: " + e.Message);
                Debug.Print("Status Code: " + e.ErrorCode);
                Debug.Print(e.StackTrace);
            }
        }
    }
}
```

#### Using the PlanListWithHttpInfo variant
This returns an ApiResponse object which contains the response data, status code and headers.

```csharp
try
{
    // List active plans with tier limits + pricing
    ApiResponse<PlanListResponse> response = apiInstance.PlanListWithHttpInfo();
    Debug.Write("Status Code: " + response.StatusCode);
    Debug.Write("Response Headers: " + response.Headers);
    Debug.Write("Response Body: " + response.Data);
}
catch (ApiException e)
{
    Debug.Print("Exception when calling AccountApi.PlanListWithHttpInfo: " + e.Message);
    Debug.Print("Status Code: " + e.ErrorCode);
    Debug.Print(e.StackTrace);
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

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

<a id="propertylist"></a>
# **PropertyList**
> PropertyListResponse PropertyList ()

List web properties configured for the caller's org

Returns every `web_properties` row for the caller's org. `property_id` values used throughout `/v1/consent/_*` come from here. The HMAC `event_signing_secret` is **not** in the response — it's a server-only key used by the Cloudflare Worker to verify inbound events. Requires an org-scoped API key; account-scoped keys get 400. 

### Example
```csharp
using System.Collections.Generic;
using System.Diagnostics;
using System.Net.Http;
using ConsentShield.Client.Api;
using ConsentShield.Client.Client;
using ConsentShield.Client.Model;

namespace Example
{
    public class PropertyListExample
    {
        public static void Main()
        {
            Configuration config = new Configuration();
            config.BasePath = "https://api.consentshield.in/v1";
            // Configure Bearer token for authorization: bearerAuth
            config.AccessToken = "YOUR_BEARER_TOKEN";

            // create instances of HttpClient, HttpClientHandler to be reused later with different Api classes
            HttpClient httpClient = new HttpClient();
            HttpClientHandler httpClientHandler = new HttpClientHandler();
            var apiInstance = new AccountApi(httpClient, config, httpClientHandler);

            try
            {
                // List web properties configured for the caller's org
                PropertyListResponse result = apiInstance.PropertyList();
                Debug.WriteLine(result);
            }
            catch (ApiException  e)
            {
                Debug.Print("Exception when calling AccountApi.PropertyList: " + e.Message);
                Debug.Print("Status Code: " + e.ErrorCode);
                Debug.Print(e.StackTrace);
            }
        }
    }
}
```

#### Using the PropertyListWithHttpInfo variant
This returns an ApiResponse object which contains the response data, status code and headers.

```csharp
try
{
    // List web properties configured for the caller's org
    ApiResponse<PropertyListResponse> response = apiInstance.PropertyListWithHttpInfo();
    Debug.Write("Status Code: " + response.StatusCode);
    Debug.Write("Response Headers: " + response.Headers);
    Debug.Write("Response Body: " + response.Data);
}
catch (ApiException e)
{
    Debug.Print("Exception when calling AccountApi.PropertyListWithHttpInfo: " + e.Message);
    Debug.Print("Status Code: " + e.ErrorCode);
    Debug.Print(e.StackTrace);
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

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

<a id="purposelist"></a>
# **PurposeList**
> PurposeListResponse PurposeList ()

List purposes configured for the caller's org

Returns every `purpose_definitions` row for the caller's org. `/v1/consent/verify` and `/v1/consent/record` both require a valid `purpose_code` or `purpose_definition_id` from this list. Requires an org-scoped API key; account-scoped keys get 400. 

### Example
```csharp
using System.Collections.Generic;
using System.Diagnostics;
using System.Net.Http;
using ConsentShield.Client.Api;
using ConsentShield.Client.Client;
using ConsentShield.Client.Model;

namespace Example
{
    public class PurposeListExample
    {
        public static void Main()
        {
            Configuration config = new Configuration();
            config.BasePath = "https://api.consentshield.in/v1";
            // Configure Bearer token for authorization: bearerAuth
            config.AccessToken = "YOUR_BEARER_TOKEN";

            // create instances of HttpClient, HttpClientHandler to be reused later with different Api classes
            HttpClient httpClient = new HttpClient();
            HttpClientHandler httpClientHandler = new HttpClientHandler();
            var apiInstance = new AccountApi(httpClient, config, httpClientHandler);

            try
            {
                // List purposes configured for the caller's org
                PurposeListResponse result = apiInstance.PurposeList();
                Debug.WriteLine(result);
            }
            catch (ApiException  e)
            {
                Debug.Print("Exception when calling AccountApi.PurposeList: " + e.Message);
                Debug.Print("Status Code: " + e.ErrorCode);
                Debug.Print(e.StackTrace);
            }
        }
    }
}
```

#### Using the PurposeListWithHttpInfo variant
This returns an ApiResponse object which contains the response data, status code and headers.

```csharp
try
{
    // List purposes configured for the caller's org
    ApiResponse<PurposeListResponse> response = apiInstance.PurposeListWithHttpInfo();
    Debug.Write("Status Code: " + response.StatusCode);
    Debug.Write("Response Headers: " + response.Headers);
    Debug.Write("Response Body: " + response.Data);
}
catch (ApiException e)
{
    Debug.Print("Exception when calling AccountApi.PurposeListWithHttpInfo: " + e.Message);
    Debug.Print("Status Code: " + e.ErrorCode);
    Debug.Print(e.StackTrace);
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

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

<a id="usage"></a>
# **Usage**
> UsageResponse Usage (int? days = null)

Per-day request count + latency for the Bearer token

Returns a day-by-day usage series for the presenting API key over the last `days` days (default 7, min 1, max 30). Zero-filled for days with no activity. Most recent day first. 

### Example
```csharp
using System.Collections.Generic;
using System.Diagnostics;
using System.Net.Http;
using ConsentShield.Client.Api;
using ConsentShield.Client.Client;
using ConsentShield.Client.Model;

namespace Example
{
    public class UsageExample
    {
        public static void Main()
        {
            Configuration config = new Configuration();
            config.BasePath = "https://api.consentshield.in/v1";
            // Configure Bearer token for authorization: bearerAuth
            config.AccessToken = "YOUR_BEARER_TOKEN";

            // create instances of HttpClient, HttpClientHandler to be reused later with different Api classes
            HttpClient httpClient = new HttpClient();
            HttpClientHandler httpClientHandler = new HttpClientHandler();
            var apiInstance = new AccountApi(httpClient, config, httpClientHandler);
            var days = 7;  // int? |  (optional)  (default to 7)

            try
            {
                // Per-day request count + latency for the Bearer token
                UsageResponse result = apiInstance.Usage(days);
                Debug.WriteLine(result);
            }
            catch (ApiException  e)
            {
                Debug.Print("Exception when calling AccountApi.Usage: " + e.Message);
                Debug.Print("Status Code: " + e.ErrorCode);
                Debug.Print(e.StackTrace);
            }
        }
    }
}
```

#### Using the UsageWithHttpInfo variant
This returns an ApiResponse object which contains the response data, status code and headers.

```csharp
try
{
    // Per-day request count + latency for the Bearer token
    ApiResponse<UsageResponse> response = apiInstance.UsageWithHttpInfo(days);
    Debug.Write("Status Code: " + response.StatusCode);
    Debug.Write("Response Headers: " + response.Headers);
    Debug.Write("Response Body: " + response.Data);
}
catch (ApiException e)
{
    Debug.Print("Exception when calling AccountApi.UsageWithHttpInfo: " + e.Message);
    Debug.Print("Status Code: " + e.ErrorCode);
    Debug.Print(e.StackTrace);
}
```

### Parameters

| Name | Type | Description | Notes |
|------|------|-------------|-------|
| **days** | **int?** |  | [optional] [default to 7] |

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

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

