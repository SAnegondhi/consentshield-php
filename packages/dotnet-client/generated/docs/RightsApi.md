# ConsentShield.Client.Api.RightsApi

All URIs are relative to *https://api.consentshield.in/v1*

| Method | HTTP request | Description |
|--------|--------------|-------------|
| [**RightsRequestCreate**](RightsApi.md#rightsrequestcreate) | **POST** /rights/requests | Create a rights request on behalf of a verified data principal |
| [**RightsRequestList**](RightsApi.md#rightsrequestlist) | **GET** /rights/requests | List rights requests for the caller&#39;s org (cursor-paginated) |

<a id="rightsrequestcreate"></a>
# **RightsRequestCreate**
> RightsRequestCreatedResponse RightsRequestCreate (RightsRequestCreateRequest rightsRequestCreateRequest)

Create a rights request on behalf of a verified data principal

Records a DPDP §11 rights request captured outside the public portal (mobile app, call-centre, branch, kiosk, CRM/helpdesk integration, in-person). Bypasses the portal's Cloudflare Turnstile and email-OTP gate because the API-key holder attests identity via `identity_verified_by` — a free-text attestation describing how identity was verified (e.g. `internal_kyc_check`, `branch_officer_id_42`). The attestation is stored on the row and echoed in a dedicated `created_via_api` audit event for DPB audit filtering. Requires an org-scoped API key; account-scoped keys get 400. The created request starts in `new` status with a 30-day SLA deadline. 

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
    public class RightsRequestCreateExample
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
            var apiInstance = new RightsApi(httpClient, config, httpClientHandler);
            var rightsRequestCreateRequest = new RightsRequestCreateRequest(); // RightsRequestCreateRequest | 

            try
            {
                // Create a rights request on behalf of a verified data principal
                RightsRequestCreatedResponse result = apiInstance.RightsRequestCreate(rightsRequestCreateRequest);
                Debug.WriteLine(result);
            }
            catch (ApiException  e)
            {
                Debug.Print("Exception when calling RightsApi.RightsRequestCreate: " + e.Message);
                Debug.Print("Status Code: " + e.ErrorCode);
                Debug.Print(e.StackTrace);
            }
        }
    }
}
```

#### Using the RightsRequestCreateWithHttpInfo variant
This returns an ApiResponse object which contains the response data, status code and headers.

```csharp
try
{
    // Create a rights request on behalf of a verified data principal
    ApiResponse<RightsRequestCreatedResponse> response = apiInstance.RightsRequestCreateWithHttpInfo(rightsRequestCreateRequest);
    Debug.Write("Status Code: " + response.StatusCode);
    Debug.Write("Response Headers: " + response.Headers);
    Debug.Write("Response Body: " + response.Data);
}
catch (ApiException e)
{
    Debug.Print("Exception when calling RightsApi.RightsRequestCreateWithHttpInfo: " + e.Message);
    Debug.Print("Status Code: " + e.ErrorCode);
    Debug.Print(e.StackTrace);
}
```

### Parameters

| Name | Type | Description | Notes |
|------|------|-------------|-------|
| **rightsRequestCreateRequest** | [**RightsRequestCreateRequest**](RightsRequestCreateRequest.md) |  |  |

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

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

<a id="rightsrequestlist"></a>
# **RightsRequestList**
> RightsRequestListResponse RightsRequestList (string? status = null, string? requestType = null, string? capturedVia = null, DateTimeOffset? createdAfter = null, DateTimeOffset? createdBefore = null, string? cursor = null, int? limit = null)

List rights requests for the caller's org (cursor-paginated)

Returns a keyset-paginated list of rights requests for the caller's org. Includes both portal-initiated and API-initiated requests; filter on `captured_via` to distinguish. `created_by_api_key_id` on each item names the specific API key that created the request (null for portal-initiated). Requires an org-scoped API key; account-scoped keys get 400. 

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
    public class RightsRequestListExample
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
            var apiInstance = new RightsApi(httpClient, config, httpClientHandler);
            var status = "new";  // string? |  (optional) 
            var requestType = "erasure";  // string? |  (optional) 
            var capturedVia = "portal";  // string? |  (optional) 
            var createdAfter = DateTimeOffset.Parse("2013-10-20T19:20:30+01:00");  // DateTimeOffset? |  (optional) 
            var createdBefore = DateTimeOffset.Parse("2013-10-20T19:20:30+01:00");  // DateTimeOffset? |  (optional) 
            var cursor = "cursor_example";  // string? |  (optional) 
            var limit = 50;  // int? |  (optional)  (default to 50)

            try
            {
                // List rights requests for the caller's org (cursor-paginated)
                RightsRequestListResponse result = apiInstance.RightsRequestList(status, requestType, capturedVia, createdAfter, createdBefore, cursor, limit);
                Debug.WriteLine(result);
            }
            catch (ApiException  e)
            {
                Debug.Print("Exception when calling RightsApi.RightsRequestList: " + e.Message);
                Debug.Print("Status Code: " + e.ErrorCode);
                Debug.Print(e.StackTrace);
            }
        }
    }
}
```

#### Using the RightsRequestListWithHttpInfo variant
This returns an ApiResponse object which contains the response data, status code and headers.

```csharp
try
{
    // List rights requests for the caller's org (cursor-paginated)
    ApiResponse<RightsRequestListResponse> response = apiInstance.RightsRequestListWithHttpInfo(status, requestType, capturedVia, createdAfter, createdBefore, cursor, limit);
    Debug.Write("Status Code: " + response.StatusCode);
    Debug.Write("Response Headers: " + response.Headers);
    Debug.Write("Response Body: " + response.Data);
}
catch (ApiException e)
{
    Debug.Print("Exception when calling RightsApi.RightsRequestListWithHttpInfo: " + e.Message);
    Debug.Print("Status Code: " + e.ErrorCode);
    Debug.Print(e.StackTrace);
}
```

### Parameters

| Name | Type | Description | Notes |
|------|------|-------------|-------|
| **status** | **string?** |  | [optional]  |
| **requestType** | **string?** |  | [optional]  |
| **capturedVia** | **string?** |  | [optional]  |
| **createdAfter** | **DateTimeOffset?** |  | [optional]  |
| **createdBefore** | **DateTimeOffset?** |  | [optional]  |
| **cursor** | **string?** |  | [optional]  |
| **limit** | **int?** |  | [optional] [default to 50] |

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

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

