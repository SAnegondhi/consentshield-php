# ConsentShield.Client.Api.AuditApi

All URIs are relative to *https://api.consentshield.in/v1*

| Method | HTTP request | Description |
|--------|--------------|-------------|
| [**AuditList**](AuditApi.md#auditlist) | **GET** /audit | List recent audit_log events for the caller&#39;s org |

<a id="auditlist"></a>
# **AuditList**
> AuditLogListResponse AuditList (string? eventType = null, string? entityType = null, DateTimeOffset? createdAfter = null, DateTimeOffset? createdBefore = null, string? cursor = null, int? limit = null)

List recent audit_log events for the caller's org

Keyset-paginated view of `public.audit_log`. **The table is a transient buffer** — rows are delivered to the customer's R2/S3 and deleted within ~5 minutes. This endpoint therefore serves only the undelivered + recently-delivered window (useful for real-time ops dashboards and SIEM polling). The canonical historical audit lives in the customer's own storage. `ip_address` is deliberately excluded from the response envelope (PII). Correlate via `actor_email` if per-person attribution is needed. Requires an org-scoped API key; account-scoped keys get 400. 

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
    public class AuditListExample
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
            var apiInstance = new AuditApi(httpClient, config, httpClientHandler);
            var eventType = "eventType_example";  // string? | Filter by exact event_type (e.g. `banner_published`, `purpose_created`). (optional) 
            var entityType = "entityType_example";  // string? | Filter by exact entity_type (e.g. `banner`, `purpose`, `property`). (optional) 
            var createdAfter = DateTimeOffset.Parse("2013-10-20T19:20:30+01:00");  // DateTimeOffset? |  (optional) 
            var createdBefore = DateTimeOffset.Parse("2013-10-20T19:20:30+01:00");  // DateTimeOffset? |  (optional) 
            var cursor = "cursor_example";  // string? |  (optional) 
            var limit = 50;  // int? |  (optional)  (default to 50)

            try
            {
                // List recent audit_log events for the caller's org
                AuditLogListResponse result = apiInstance.AuditList(eventType, entityType, createdAfter, createdBefore, cursor, limit);
                Debug.WriteLine(result);
            }
            catch (ApiException  e)
            {
                Debug.Print("Exception when calling AuditApi.AuditList: " + e.Message);
                Debug.Print("Status Code: " + e.ErrorCode);
                Debug.Print(e.StackTrace);
            }
        }
    }
}
```

#### Using the AuditListWithHttpInfo variant
This returns an ApiResponse object which contains the response data, status code and headers.

```csharp
try
{
    // List recent audit_log events for the caller's org
    ApiResponse<AuditLogListResponse> response = apiInstance.AuditListWithHttpInfo(eventType, entityType, createdAfter, createdBefore, cursor, limit);
    Debug.Write("Status Code: " + response.StatusCode);
    Debug.Write("Response Headers: " + response.Headers);
    Debug.Write("Response Body: " + response.Data);
}
catch (ApiException e)
{
    Debug.Print("Exception when calling AuditApi.AuditListWithHttpInfo: " + e.Message);
    Debug.Print("Status Code: " + e.ErrorCode);
    Debug.Print(e.StackTrace);
}
```

### Parameters

| Name | Type | Description | Notes |
|------|------|-------------|-------|
| **eventType** | **string?** | Filter by exact event_type (e.g. &#x60;banner_published&#x60;, &#x60;purpose_created&#x60;). | [optional]  |
| **entityType** | **string?** | Filter by exact entity_type (e.g. &#x60;banner&#x60;, &#x60;purpose&#x60;, &#x60;property&#x60;). | [optional]  |
| **createdAfter** | **DateTimeOffset?** |  | [optional]  |
| **createdBefore** | **DateTimeOffset?** |  | [optional]  |
| **cursor** | **string?** |  | [optional]  |
| **limit** | **int?** |  | [optional] [default to 50] |

### Return type

[**AuditLogListResponse**](AuditLogListResponse.md)

### Authorization

[bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json, application/problem+json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Paged audit list. |  -  |
| **400** | API key is account-scoped; this endpoint requires an org-scoped key. |  -  |
| **401** | Missing, malformed, or invalid API key. |  -  |
| **403** | Missing &#x60;read:audit&#x60; scope, or API key is not authorised for this organisation. |  -  |
| **410** | API key has been revoked. |  -  |
| **422** | Bad cursor, limit, or date. |  -  |
| **429** | Rate limit exceeded. |  * Retry-After - Seconds until the rate-limit window resets. <br>  * X-RateLimit-Limit - Requests allowed per hour for this key&#39;s tier. <br>  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

