# ConsentShield.Client.Api.ScoreApi

All URIs are relative to *https://api.consentshield.in/v1*

| Method | HTTP request | Description |
|--------|--------------|-------------|
| [**ScoreSelf**](ScoreApi.md#scoreself) | **GET** /score | Current DEPA compliance score for the caller&#39;s org |

<a id="scoreself"></a>
# **ScoreSelf**
> DepaScoreResponse ScoreSelf ()

Current DEPA compliance score for the caller's org

Reads the cached DEPA score from `public.depa_compliance_metrics` (ADR-0025). Refreshed nightly by pg_cron; `computed_at` shows freshness. All four dimension scores are on a 0..5 scale; `total_score` = sum on a 0..20 scale. `max_score` is a fixed constant (20) to make ratio arithmetic easy. If the nightly refresh has not yet run for this org, every score field is `null`, `computed_at` is `null`, and `max_score` is still `20`. Clients should treat a null `total_score` as \"no data yet\" rather than 0. Requires an org-scoped API key; account-scoped keys get 400. 

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
    public class ScoreSelfExample
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
            var apiInstance = new ScoreApi(httpClient, config, httpClientHandler);

            try
            {
                // Current DEPA compliance score for the caller's org
                DepaScoreResponse result = apiInstance.ScoreSelf();
                Debug.WriteLine(result);
            }
            catch (ApiException  e)
            {
                Debug.Print("Exception when calling ScoreApi.ScoreSelf: " + e.Message);
                Debug.Print("Status Code: " + e.ErrorCode);
                Debug.Print(e.StackTrace);
            }
        }
    }
}
```

#### Using the ScoreSelfWithHttpInfo variant
This returns an ApiResponse object which contains the response data, status code and headers.

```csharp
try
{
    // Current DEPA compliance score for the caller's org
    ApiResponse<DepaScoreResponse> response = apiInstance.ScoreSelfWithHttpInfo();
    Debug.Write("Status Code: " + response.StatusCode);
    Debug.Write("Response Headers: " + response.Headers);
    Debug.Write("Response Body: " + response.Data);
}
catch (ApiException e)
{
    Debug.Print("Exception when calling ScoreApi.ScoreSelfWithHttpInfo: " + e.Message);
    Debug.Print("Status Code: " + e.ErrorCode);
    Debug.Print(e.StackTrace);
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

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

