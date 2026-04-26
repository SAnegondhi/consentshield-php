# ConsentShield.Client.Api.UtilityApi

All URIs are relative to *https://api.consentshield.in/v1*

| Method | HTTP request | Description |
|--------|--------------|-------------|
| [**Ping**](UtilityApi.md#ping) | **GET** /_ping | Canary health-check |

<a id="ping"></a>
# **Ping**
> PingResponse Ping ()

Canary health-check

Returns the resolved context for the authenticated key. Use this to verify your API key is valid, confirm scopes, and check the rate tier before calling data endpoints. 

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
    public class PingExample
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
            var apiInstance = new UtilityApi(httpClient, config, httpClientHandler);

            try
            {
                // Canary health-check
                PingResponse result = apiInstance.Ping();
                Debug.WriteLine(result);
            }
            catch (ApiException  e)
            {
                Debug.Print("Exception when calling UtilityApi.Ping: " + e.Message);
                Debug.Print("Status Code: " + e.ErrorCode);
                Debug.Print(e.StackTrace);
            }
        }
    }
}
```

#### Using the PingWithHttpInfo variant
This returns an ApiResponse object which contains the response data, status code and headers.

```csharp
try
{
    // Canary health-check
    ApiResponse<PingResponse> response = apiInstance.PingWithHttpInfo();
    Debug.Write("Status Code: " + response.StatusCode);
    Debug.Write("Response Headers: " + response.Headers);
    Debug.Write("Response Body: " + response.Data);
}
catch (ApiException e)
{
    Debug.Print("Exception when calling UtilityApi.PingWithHttpInfo: " + e.Message);
    Debug.Print("Status Code: " + e.ErrorCode);
    Debug.Print(e.StackTrace);
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

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

