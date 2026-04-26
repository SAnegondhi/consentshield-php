# ConsentShield.Client.Api.SecurityApi

All URIs are relative to *https://api.consentshield.in/v1*

| Method | HTTP request | Description |
|--------|--------------|-------------|
| [**SecurityScansList**](SecurityApi.md#securityscanslist) | **GET** /security/scans | List recent security-posture scan findings |

<a id="securityscanslist"></a>
# **SecurityScansList**
> SecurityScanListResponse SecurityScansList (Guid? propertyId = null, string? severity = null, string? signalKey = null, DateTimeOffset? scannedAfter = null, DateTimeOffset? scannedBefore = null, string? cursor = null, int? limit = null)

List recent security-posture scan findings

Keyset-paginated view of `public.security_scans`. **The table is a transient buffer** — rows are delivered to the customer's R2/S3 and deleted within ~5 minutes. This endpoint serves only the recent window. Populated nightly by the `run-security-scans` Edge Function (ADR-0015); one row per finding per property, plus an `all_clean` row with `severity=info` for trend tracking. Requires an org-scoped API key; account-scoped keys get 400. 

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
    public class SecurityScansListExample
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
            var apiInstance = new SecurityApi(httpClient, config, httpClientHandler);
            var propertyId = "propertyId_example";  // Guid? |  (optional) 
            var severity = "critical";  // string? |  (optional) 
            var signalKey = "signalKey_example";  // string? | e.g. `missing_csp`, `missing_hsts`, `tls_invalid`, `all_clean`. (optional) 
            var scannedAfter = DateTimeOffset.Parse("2013-10-20T19:20:30+01:00");  // DateTimeOffset? |  (optional) 
            var scannedBefore = DateTimeOffset.Parse("2013-10-20T19:20:30+01:00");  // DateTimeOffset? |  (optional) 
            var cursor = "cursor_example";  // string? |  (optional) 
            var limit = 50;  // int? |  (optional)  (default to 50)

            try
            {
                // List recent security-posture scan findings
                SecurityScanListResponse result = apiInstance.SecurityScansList(propertyId, severity, signalKey, scannedAfter, scannedBefore, cursor, limit);
                Debug.WriteLine(result);
            }
            catch (ApiException  e)
            {
                Debug.Print("Exception when calling SecurityApi.SecurityScansList: " + e.Message);
                Debug.Print("Status Code: " + e.ErrorCode);
                Debug.Print(e.StackTrace);
            }
        }
    }
}
```

#### Using the SecurityScansListWithHttpInfo variant
This returns an ApiResponse object which contains the response data, status code and headers.

```csharp
try
{
    // List recent security-posture scan findings
    ApiResponse<SecurityScanListResponse> response = apiInstance.SecurityScansListWithHttpInfo(propertyId, severity, signalKey, scannedAfter, scannedBefore, cursor, limit);
    Debug.Write("Status Code: " + response.StatusCode);
    Debug.Write("Response Headers: " + response.Headers);
    Debug.Write("Response Body: " + response.Data);
}
catch (ApiException e)
{
    Debug.Print("Exception when calling SecurityApi.SecurityScansListWithHttpInfo: " + e.Message);
    Debug.Print("Status Code: " + e.ErrorCode);
    Debug.Print(e.StackTrace);
}
```

### Parameters

| Name | Type | Description | Notes |
|------|------|-------------|-------|
| **propertyId** | **Guid?** |  | [optional]  |
| **severity** | **string?** |  | [optional]  |
| **signalKey** | **string?** | e.g. &#x60;missing_csp&#x60;, &#x60;missing_hsts&#x60;, &#x60;tls_invalid&#x60;, &#x60;all_clean&#x60;. | [optional]  |
| **scannedAfter** | **DateTimeOffset?** |  | [optional]  |
| **scannedBefore** | **DateTimeOffset?** |  | [optional]  |
| **cursor** | **string?** |  | [optional]  |
| **limit** | **int?** |  | [optional] [default to 50] |

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

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

