# ConsentShield.Client.Api.DeletionApi

All URIs are relative to *https://api.consentshield.in/v1*

| Method | HTTP request | Description |
|--------|--------------|-------------|
| [**DeletionReceiptsList**](DeletionApi.md#deletionreceiptslist) | **GET** /deletion/receipts | List deletion receipts |
| [**DeletionTrigger**](DeletionApi.md#deletiontrigger) | **POST** /deletion/trigger | Trigger deletion orchestration for a data principal |
| [**IntegrationsTestDelete**](DeletionApi.md#integrationstestdelete) | **POST** /integrations/{connector_id}/test_delete | Exercise a customer deletion-webhook handler without real data |

<a id="deletionreceiptslist"></a>
# **DeletionReceiptsList**
> DeletionReceiptsResponse DeletionReceiptsList (string? status = null, Guid? connectorId = null, string? artefactId = null, DateTimeOffset? issuedAfter = null, DateTimeOffset? issuedBefore = null, string? cursor = null, int? limit = null)

List deletion receipts

Cursor-paginated list with filters on status, connector, source artefact_id, and issue date range. 

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
    public class DeletionReceiptsListExample
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
            var apiInstance = new DeletionApi(httpClient, config, httpClientHandler);
            var status = "status_example";  // string? |  (optional) 
            var connectorId = "connectorId_example";  // Guid? |  (optional) 
            var artefactId = "artefactId_example";  // string? |  (optional) 
            var issuedAfter = DateTimeOffset.Parse("2013-10-20T19:20:30+01:00");  // DateTimeOffset? |  (optional) 
            var issuedBefore = DateTimeOffset.Parse("2013-10-20T19:20:30+01:00");  // DateTimeOffset? |  (optional) 
            var cursor = "cursor_example";  // string? |  (optional) 
            var limit = 50;  // int? |  (optional)  (default to 50)

            try
            {
                // List deletion receipts
                DeletionReceiptsResponse result = apiInstance.DeletionReceiptsList(status, connectorId, artefactId, issuedAfter, issuedBefore, cursor, limit);
                Debug.WriteLine(result);
            }
            catch (ApiException  e)
            {
                Debug.Print("Exception when calling DeletionApi.DeletionReceiptsList: " + e.Message);
                Debug.Print("Status Code: " + e.ErrorCode);
                Debug.Print(e.StackTrace);
            }
        }
    }
}
```

#### Using the DeletionReceiptsListWithHttpInfo variant
This returns an ApiResponse object which contains the response data, status code and headers.

```csharp
try
{
    // List deletion receipts
    ApiResponse<DeletionReceiptsResponse> response = apiInstance.DeletionReceiptsListWithHttpInfo(status, connectorId, artefactId, issuedAfter, issuedBefore, cursor, limit);
    Debug.Write("Status Code: " + response.StatusCode);
    Debug.Write("Response Headers: " + response.Headers);
    Debug.Write("Response Body: " + response.Data);
}
catch (ApiException e)
{
    Debug.Print("Exception when calling DeletionApi.DeletionReceiptsListWithHttpInfo: " + e.Message);
    Debug.Print("Status Code: " + e.ErrorCode);
    Debug.Print(e.StackTrace);
}
```

### Parameters

| Name | Type | Description | Notes |
|------|------|-------------|-------|
| **status** | **string?** |  | [optional]  |
| **connectorId** | **Guid?** |  | [optional]  |
| **artefactId** | **string?** |  | [optional]  |
| **issuedAfter** | **DateTimeOffset?** |  | [optional]  |
| **issuedBefore** | **DateTimeOffset?** |  | [optional]  |
| **cursor** | **string?** |  | [optional]  |
| **limit** | **int?** |  | [optional] [default to 50] |

### Return type

[**DeletionReceiptsResponse**](DeletionReceiptsResponse.md)

### Authorization

[bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json, application/problem+json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Paged list envelope. |  -  |
| **401** | Missing, malformed, or invalid API key. |  -  |
| **403** | Key is valid but lacks read:deletion scope. |  -  |
| **410** | API key has been revoked. |  -  |
| **422** | Bad cursor, limit, or date. |  -  |
| **429** | Rate limit exceeded. |  * Retry-After - Seconds until the rate-limit window resets. <br>  * X-RateLimit-Limit - Requests allowed per hour for this key&#39;s tier. <br>  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

<a id="deletiontrigger"></a>
# **DeletionTrigger**
> DeletionTriggerResponse DeletionTrigger (DeletionTriggerRequest deletionTriggerRequest)

Trigger deletion orchestration for a data principal

Inserts `artefact_revocations` rows for every active artefact matching the scope. The ADR-0022 cascade + process-artefact-revocation Edge Function then create `deletion_receipts` asynchronously. `retention_expired` mode is not yet implemented (returns 501). 

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
    public class DeletionTriggerExample
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
            var apiInstance = new DeletionApi(httpClient, config, httpClientHandler);
            var deletionTriggerRequest = new DeletionTriggerRequest(); // DeletionTriggerRequest | 

            try
            {
                // Trigger deletion orchestration for a data principal
                DeletionTriggerResponse result = apiInstance.DeletionTrigger(deletionTriggerRequest);
                Debug.WriteLine(result);
            }
            catch (ApiException  e)
            {
                Debug.Print("Exception when calling DeletionApi.DeletionTrigger: " + e.Message);
                Debug.Print("Status Code: " + e.ErrorCode);
                Debug.Print(e.StackTrace);
            }
        }
    }
}
```

#### Using the DeletionTriggerWithHttpInfo variant
This returns an ApiResponse object which contains the response data, status code and headers.

```csharp
try
{
    // Trigger deletion orchestration for a data principal
    ApiResponse<DeletionTriggerResponse> response = apiInstance.DeletionTriggerWithHttpInfo(deletionTriggerRequest);
    Debug.Write("Status Code: " + response.StatusCode);
    Debug.Write("Response Headers: " + response.Headers);
    Debug.Write("Response Body: " + response.Data);
}
catch (ApiException e)
{
    Debug.Print("Exception when calling DeletionApi.DeletionTriggerWithHttpInfo: " + e.Message);
    Debug.Print("Status Code: " + e.ErrorCode);
    Debug.Print(e.StackTrace);
}
```

### Parameters

| Name | Type | Description | Notes |
|------|------|-------------|-------|
| **deletionTriggerRequest** | [**DeletionTriggerRequest**](DeletionTriggerRequest.md) |  |  |

### Return type

[**DeletionTriggerResponse**](DeletionTriggerResponse.md)

### Authorization

[bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json, application/problem+json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **202** | Revocations inserted; deletion_receipts are being created asynchronously. |  -  |
| **401** | Missing, malformed, or invalid API key. |  -  |
| **403** | Key is valid but lacks write:deletion scope. |  -  |
| **404** | property_id does not belong to the key&#39;s org. |  -  |
| **410** | API key has been revoked. |  -  |
| **422** | Invalid body, missing purpose_codes for consent_revoked, or unknown reason/actor_type/identifier. |  -  |
| **429** | Rate limit exceeded. |  * Retry-After - Seconds until the rate-limit window resets. <br>  * X-RateLimit-Limit - Requests allowed per hour for this key&#39;s tier. <br>  |
| **501** | retention_expired mode is not yet implemented. |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

<a id="integrationstestdelete"></a>
# **IntegrationsTestDelete**
> TestDeleteResponse IntegrationsTestDelete (Guid connectorId)

Exercise a customer deletion-webhook handler without real data

Creates a synthetic deletion request against the named connector. Generates a random `cs_test_principal_<uuid>` data_principal and writes a `deletion_receipts` row with `trigger_type='test_delete'` and `request_payload.is_test=true`. Customer handlers should inspect `request_payload.reason=='test'` and short-circuit without deleting real data. Rate-limited to 10 calls per connector per hour. Test rows have `artefact_id=null` so compliance aggregations exclude them. 

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
    public class IntegrationsTestDeleteExample
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
            var apiInstance = new DeletionApi(httpClient, config, httpClientHandler);
            var connectorId = "connectorId_example";  // Guid | 

            try
            {
                // Exercise a customer deletion-webhook handler without real data
                TestDeleteResponse result = apiInstance.IntegrationsTestDelete(connectorId);
                Debug.WriteLine(result);
            }
            catch (ApiException  e)
            {
                Debug.Print("Exception when calling DeletionApi.IntegrationsTestDelete: " + e.Message);
                Debug.Print("Status Code: " + e.ErrorCode);
                Debug.Print(e.StackTrace);
            }
        }
    }
}
```

#### Using the IntegrationsTestDeleteWithHttpInfo variant
This returns an ApiResponse object which contains the response data, status code and headers.

```csharp
try
{
    // Exercise a customer deletion-webhook handler without real data
    ApiResponse<TestDeleteResponse> response = apiInstance.IntegrationsTestDeleteWithHttpInfo(connectorId);
    Debug.Write("Status Code: " + response.StatusCode);
    Debug.Write("Response Headers: " + response.Headers);
    Debug.Write("Response Body: " + response.Data);
}
catch (ApiException e)
{
    Debug.Print("Exception when calling DeletionApi.IntegrationsTestDeleteWithHttpInfo: " + e.Message);
    Debug.Print("Status Code: " + e.ErrorCode);
    Debug.Print(e.StackTrace);
}
```

### Parameters

| Name | Type | Description | Notes |
|------|------|-------------|-------|
| **connectorId** | **Guid** |  |  |

### Return type

[**TestDeleteResponse**](TestDeleteResponse.md)

### Authorization

[bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json, application/problem+json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **202** | Test deletion receipt created; delivery is async. |  -  |
| **401** | Missing, malformed, or invalid API key. |  -  |
| **403** | Key is valid but lacks write:deletion scope or does not authorise the org. |  -  |
| **404** | connector_id does not belong to the key&#39;s org. |  -  |
| **410** | API key has been revoked. |  -  |
| **422** | connector_id malformed or connector is not active. |  -  |
| **429** | Rate limit — 10 test_delete calls per connector per hour. |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

