# ConsentShield.Client.Api.ConsentApi

All URIs are relative to *https://api.consentshield.in/v1*

| Method | HTTP request | Description |
|--------|--------------|-------------|
| [**ConsentArtefactGet**](ConsentApi.md#consentartefactget) | **GET** /consent/artefacts/{id} | Get a single consent artefact |
| [**ConsentArtefactRevoke**](ConsentApi.md#consentartefactrevoke) | **POST** /consent/artefacts/{id}/revoke | Revoke a consent artefact |
| [**ConsentArtefactsList**](ConsentApi.md#consentartefactslist) | **GET** /consent/artefacts | List consent artefacts (cursor-paginated) |
| [**ConsentEventsList**](ConsentApi.md#consenteventslist) | **GET** /consent/events | List consent events (summary only, cursor-paginated) |
| [**ConsentRecord**](ConsentApi.md#consentrecord) | **POST** /consent/record | Mode B server-to-server consent capture |
| [**ConsentVerify**](ConsentApi.md#consentverify) | **GET** /consent/verify | Single-identifier consent verification |
| [**ConsentVerifyBatch**](ConsentApi.md#consentverifybatch) | **POST** /consent/verify/batch | Batched consent verification |

<a id="consentartefactget"></a>
# **ConsentArtefactGet**
> ArtefactDetail ConsentArtefactGet (string id)

Get a single consent artefact

Returns the artefact envelope + revocation record (if any) + full replacement chain in chronological order. 

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
    public class ConsentArtefactGetExample
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
            var apiInstance = new ConsentApi(httpClient, config, httpClientHandler);
            var id = "id_example";  // string | 

            try
            {
                // Get a single consent artefact
                ArtefactDetail result = apiInstance.ConsentArtefactGet(id);
                Debug.WriteLine(result);
            }
            catch (ApiException  e)
            {
                Debug.Print("Exception when calling ConsentApi.ConsentArtefactGet: " + e.Message);
                Debug.Print("Status Code: " + e.ErrorCode);
                Debug.Print(e.StackTrace);
            }
        }
    }
}
```

#### Using the ConsentArtefactGetWithHttpInfo variant
This returns an ApiResponse object which contains the response data, status code and headers.

```csharp
try
{
    // Get a single consent artefact
    ApiResponse<ArtefactDetail> response = apiInstance.ConsentArtefactGetWithHttpInfo(id);
    Debug.Write("Status Code: " + response.StatusCode);
    Debug.Write("Response Headers: " + response.Headers);
    Debug.Write("Response Body: " + response.Data);
}
catch (ApiException e)
{
    Debug.Print("Exception when calling ConsentApi.ConsentArtefactGetWithHttpInfo: " + e.Message);
    Debug.Print("Status Code: " + e.ErrorCode);
    Debug.Print(e.StackTrace);
}
```

### Parameters

| Name | Type | Description | Notes |
|------|------|-------------|-------|
| **id** | **string** |  |  |

### Return type

[**ArtefactDetail**](ArtefactDetail.md)

### Authorization

[bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json, application/problem+json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Artefact detail. |  -  |
| **401** | Missing, malformed, or invalid API key. |  -  |
| **403** | Key is valid but lacks read:artefacts scope. |  -  |
| **404** | No artefact with that id belongs to the key&#39;s org. |  -  |
| **410** | API key has been revoked. |  -  |
| **429** | Rate limit exceeded. |  * Retry-After - Seconds until the rate-limit window resets. <br>  * X-RateLimit-Limit - Requests allowed per hour for this key&#39;s tier. <br>  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

<a id="consentartefactrevoke"></a>
# **ConsentArtefactRevoke**
> RevokeResponse ConsentArtefactRevoke (string id, RevokeRequest revokeRequest)

Revoke a consent artefact

Records a revocation event for the artefact. The ADR-0022 cascade trigger flips consent_artefacts.status to `revoked` and updates the consent_artefact_index. Idempotent — calling revoke on an already- revoked artefact returns 200 with the existing revocation_record_id. Terminal states (`expired`, `replaced`) cannot be revoked and return 409. 

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
    public class ConsentArtefactRevokeExample
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
            var apiInstance = new ConsentApi(httpClient, config, httpClientHandler);
            var id = "id_example";  // string | 
            var revokeRequest = new RevokeRequest(); // RevokeRequest | 

            try
            {
                // Revoke a consent artefact
                RevokeResponse result = apiInstance.ConsentArtefactRevoke(id, revokeRequest);
                Debug.WriteLine(result);
            }
            catch (ApiException  e)
            {
                Debug.Print("Exception when calling ConsentApi.ConsentArtefactRevoke: " + e.Message);
                Debug.Print("Status Code: " + e.ErrorCode);
                Debug.Print(e.StackTrace);
            }
        }
    }
}
```

#### Using the ConsentArtefactRevokeWithHttpInfo variant
This returns an ApiResponse object which contains the response data, status code and headers.

```csharp
try
{
    // Revoke a consent artefact
    ApiResponse<RevokeResponse> response = apiInstance.ConsentArtefactRevokeWithHttpInfo(id, revokeRequest);
    Debug.Write("Status Code: " + response.StatusCode);
    Debug.Write("Response Headers: " + response.Headers);
    Debug.Write("Response Body: " + response.Data);
}
catch (ApiException e)
{
    Debug.Print("Exception when calling ConsentApi.ConsentArtefactRevokeWithHttpInfo: " + e.Message);
    Debug.Print("Status Code: " + e.ErrorCode);
    Debug.Print(e.StackTrace);
}
```

### Parameters

| Name | Type | Description | Notes |
|------|------|-------------|-------|
| **id** | **string** |  |  |
| **revokeRequest** | [**RevokeRequest**](RevokeRequest.md) |  |  |

### Return type

[**RevokeResponse**](RevokeResponse.md)

### Authorization

[bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json, application/problem+json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Revoked (new or idempotent replay). |  -  |
| **401** | Missing, malformed, or invalid API key. |  -  |
| **403** | Key is valid but lacks write:artefacts scope. |  -  |
| **404** | No artefact with that id belongs to the key&#39;s org. |  -  |
| **409** | Artefact is in a terminal state (expired or replaced) and cannot be revoked. |  -  |
| **410** | API key has been revoked. |  -  |
| **422** | Missing reason_code, malformed body, or unknown actor_type. |  -  |
| **429** | Rate limit exceeded. |  * Retry-After - Seconds until the rate-limit window resets. <br>  * X-RateLimit-Limit - Requests allowed per hour for this key&#39;s tier. <br>  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

<a id="consentartefactslist"></a>
# **ConsentArtefactsList**
> ArtefactListResponse ConsentArtefactsList (Guid? propertyId = null, string? dataPrincipalIdentifier = null, string? identifierType = null, string? status = null, string? purposeCode = null, DateTimeOffset? expiresBefore = null, DateTimeOffset? expiresAfter = null, string? cursor = null, int? limit = null)

List consent artefacts (cursor-paginated)

Returns artefacts for the key's org with keyset pagination and optional filters. `data_principal_identifier` + `identifier_type` must be supplied together to filter by identity. 

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
    public class ConsentArtefactsListExample
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
            var apiInstance = new ConsentApi(httpClient, config, httpClientHandler);
            var propertyId = "propertyId_example";  // Guid? |  (optional) 
            var dataPrincipalIdentifier = "dataPrincipalIdentifier_example";  // string? |  (optional) 
            var identifierType = "email";  // string? |  (optional) 
            var status = "active";  // string? |  (optional) 
            var purposeCode = "purposeCode_example";  // string? |  (optional) 
            var expiresBefore = DateTimeOffset.Parse("2013-10-20T19:20:30+01:00");  // DateTimeOffset? |  (optional) 
            var expiresAfter = DateTimeOffset.Parse("2013-10-20T19:20:30+01:00");  // DateTimeOffset? |  (optional) 
            var cursor = "cursor_example";  // string? |  (optional) 
            var limit = 50;  // int? |  (optional)  (default to 50)

            try
            {
                // List consent artefacts (cursor-paginated)
                ArtefactListResponse result = apiInstance.ConsentArtefactsList(propertyId, dataPrincipalIdentifier, identifierType, status, purposeCode, expiresBefore, expiresAfter, cursor, limit);
                Debug.WriteLine(result);
            }
            catch (ApiException  e)
            {
                Debug.Print("Exception when calling ConsentApi.ConsentArtefactsList: " + e.Message);
                Debug.Print("Status Code: " + e.ErrorCode);
                Debug.Print(e.StackTrace);
            }
        }
    }
}
```

#### Using the ConsentArtefactsListWithHttpInfo variant
This returns an ApiResponse object which contains the response data, status code and headers.

```csharp
try
{
    // List consent artefacts (cursor-paginated)
    ApiResponse<ArtefactListResponse> response = apiInstance.ConsentArtefactsListWithHttpInfo(propertyId, dataPrincipalIdentifier, identifierType, status, purposeCode, expiresBefore, expiresAfter, cursor, limit);
    Debug.Write("Status Code: " + response.StatusCode);
    Debug.Write("Response Headers: " + response.Headers);
    Debug.Write("Response Body: " + response.Data);
}
catch (ApiException e)
{
    Debug.Print("Exception when calling ConsentApi.ConsentArtefactsListWithHttpInfo: " + e.Message);
    Debug.Print("Status Code: " + e.ErrorCode);
    Debug.Print(e.StackTrace);
}
```

### Parameters

| Name | Type | Description | Notes |
|------|------|-------------|-------|
| **propertyId** | **Guid?** |  | [optional]  |
| **dataPrincipalIdentifier** | **string?** |  | [optional]  |
| **identifierType** | **string?** |  | [optional]  |
| **status** | **string?** |  | [optional]  |
| **purposeCode** | **string?** |  | [optional]  |
| **expiresBefore** | **DateTimeOffset?** |  | [optional]  |
| **expiresAfter** | **DateTimeOffset?** |  | [optional]  |
| **cursor** | **string?** |  | [optional]  |
| **limit** | **int?** |  | [optional] [default to 50] |

### Return type

[**ArtefactListResponse**](ArtefactListResponse.md)

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
| **403** | Key is valid but lacks read:artefacts scope. |  -  |
| **410** | API key has been revoked. |  -  |
| **422** | Invalid filter combination, bad cursor, malformed identifier, or bad limit/date. |  -  |
| **429** | Rate limit exceeded. |  * Retry-After - Seconds until the rate-limit window resets. <br>  * X-RateLimit-Limit - Requests allowed per hour for this key&#39;s tier. <br>  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

<a id="consenteventslist"></a>
# **ConsentEventsList**
> EventListResponse ConsentEventsList (Guid? propertyId = null, DateTimeOffset? createdAfter = null, DateTimeOffset? createdBefore = null, string? source = null, string? cursor = null, int? limit = null)

List consent events (summary only, cursor-paginated)

Returns paginated summaries (counts, not full payloads) of consent_events rows. Use for §11 audit timelines. 

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
    public class ConsentEventsListExample
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
            var apiInstance = new ConsentApi(httpClient, config, httpClientHandler);
            var propertyId = "propertyId_example";  // Guid? |  (optional) 
            var createdAfter = DateTimeOffset.Parse("2013-10-20T19:20:30+01:00");  // DateTimeOffset? |  (optional) 
            var createdBefore = DateTimeOffset.Parse("2013-10-20T19:20:30+01:00");  // DateTimeOffset? |  (optional) 
            var source = "web";  // string? |  (optional) 
            var cursor = "cursor_example";  // string? |  (optional) 
            var limit = 50;  // int? |  (optional)  (default to 50)

            try
            {
                // List consent events (summary only, cursor-paginated)
                EventListResponse result = apiInstance.ConsentEventsList(propertyId, createdAfter, createdBefore, source, cursor, limit);
                Debug.WriteLine(result);
            }
            catch (ApiException  e)
            {
                Debug.Print("Exception when calling ConsentApi.ConsentEventsList: " + e.Message);
                Debug.Print("Status Code: " + e.ErrorCode);
                Debug.Print(e.StackTrace);
            }
        }
    }
}
```

#### Using the ConsentEventsListWithHttpInfo variant
This returns an ApiResponse object which contains the response data, status code and headers.

```csharp
try
{
    // List consent events (summary only, cursor-paginated)
    ApiResponse<EventListResponse> response = apiInstance.ConsentEventsListWithHttpInfo(propertyId, createdAfter, createdBefore, source, cursor, limit);
    Debug.Write("Status Code: " + response.StatusCode);
    Debug.Write("Response Headers: " + response.Headers);
    Debug.Write("Response Body: " + response.Data);
}
catch (ApiException e)
{
    Debug.Print("Exception when calling ConsentApi.ConsentEventsListWithHttpInfo: " + e.Message);
    Debug.Print("Status Code: " + e.ErrorCode);
    Debug.Print(e.StackTrace);
}
```

### Parameters

| Name | Type | Description | Notes |
|------|------|-------------|-------|
| **propertyId** | **Guid?** |  | [optional]  |
| **createdAfter** | **DateTimeOffset?** |  | [optional]  |
| **createdBefore** | **DateTimeOffset?** |  | [optional]  |
| **source** | **string?** |  | [optional]  |
| **cursor** | **string?** |  | [optional]  |
| **limit** | **int?** |  | [optional] [default to 50] |

### Return type

[**EventListResponse**](EventListResponse.md)

### Authorization

[bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json, application/problem+json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Paged event list envelope. |  -  |
| **401** | Missing, malformed, or invalid API key. |  -  |
| **403** | Key is valid but lacks read:consent scope. |  -  |
| **410** | API key has been revoked. |  -  |
| **422** | Bad cursor, limit, date, or source. |  -  |
| **429** | Rate limit exceeded. |  * Retry-After - Seconds until the rate-limit window resets. <br>  * X-RateLimit-Limit - Requests allowed per hour for this key&#39;s tier. <br>  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

<a id="consentrecord"></a>
# **ConsentRecord**
> RecordResponse ConsentRecord (RecordRequest recordRequest)

Mode B server-to-server consent capture

Records a consent event captured outside the browser (mobile app, call-centre, branch, kiosk, in-person) and issues one artefact per granted purpose. Use client_request_id for safe retries. 

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
    public class ConsentRecordExample
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
            var apiInstance = new ConsentApi(httpClient, config, httpClientHandler);
            var recordRequest = new RecordRequest(); // RecordRequest | 

            try
            {
                // Mode B server-to-server consent capture
                RecordResponse result = apiInstance.ConsentRecord(recordRequest);
                Debug.WriteLine(result);
            }
            catch (ApiException  e)
            {
                Debug.Print("Exception when calling ConsentApi.ConsentRecord: " + e.Message);
                Debug.Print("Status Code: " + e.ErrorCode);
                Debug.Print(e.StackTrace);
            }
        }
    }
}
```

#### Using the ConsentRecordWithHttpInfo variant
This returns an ApiResponse object which contains the response data, status code and headers.

```csharp
try
{
    // Mode B server-to-server consent capture
    ApiResponse<RecordResponse> response = apiInstance.ConsentRecordWithHttpInfo(recordRequest);
    Debug.Write("Status Code: " + response.StatusCode);
    Debug.Write("Response Headers: " + response.Headers);
    Debug.Write("Response Body: " + response.Data);
}
catch (ApiException e)
{
    Debug.Print("Exception when calling ConsentApi.ConsentRecordWithHttpInfo: " + e.Message);
    Debug.Print("Status Code: " + e.ErrorCode);
    Debug.Print(e.StackTrace);
}
```

### Parameters

| Name | Type | Description | Notes |
|------|------|-------------|-------|
| **recordRequest** | [**RecordRequest**](RecordRequest.md) |  |  |

### Return type

[**RecordResponse**](RecordResponse.md)

### Authorization

[bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json, application/problem+json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** | Consent recorded; artefacts created. |  -  |
| **200** | Idempotent replay — a prior call with the same client_request_id returned this envelope. |  -  |
| **401** | Missing, malformed, or invalid API key. |  -  |
| **403** | Key is valid but lacks the write:consent scope. |  -  |
| **404** | property_id does not belong to the key&#39;s org. |  -  |
| **410** | API key has been revoked. |  -  |
| **422** | Missing/invalid field, stale captured_at, empty purposes, purpose id from another org, or unknown identifier_type. |  -  |
| **429** | Rate limit exceeded. |  * Retry-After - Seconds until the rate-limit window resets. <br>  * X-RateLimit-Limit - Requests allowed per hour for this key&#39;s tier. <br>  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

<a id="consentverify"></a>
# **ConsentVerify**
> VerifyResponse ConsentVerify (Guid propertyId, string dataPrincipalIdentifier, string identifierType, string purposeCode)

Single-identifier consent verification

DPDP §6 runtime check. Given a data principal identifier, property, and purpose code, returns whether consent is currently granted, revoked, expired, or never recorded. Identifier is hashed server-side with the org's per-org salt — plaintext is never stored. 

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
    public class ConsentVerifyExample
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
            var apiInstance = new ConsentApi(httpClient, config, httpClientHandler);
            var propertyId = "propertyId_example";  // Guid | 
            var dataPrincipalIdentifier = "dataPrincipalIdentifier_example";  // string | Caller's identifier for the data principal (email, phone, PAN, etc.). Hashed server-side; never stored.
            var identifierType = "email";  // string | Determines normalisation rule: email=trim+lowercase; phone/aadhaar=digits only; pan=trim+uppercase; custom=trim. Callers MUST use the same type at record-time and verify-time.
            var purposeCode = "purposeCode_example";  // string | 

            try
            {
                // Single-identifier consent verification
                VerifyResponse result = apiInstance.ConsentVerify(propertyId, dataPrincipalIdentifier, identifierType, purposeCode);
                Debug.WriteLine(result);
            }
            catch (ApiException  e)
            {
                Debug.Print("Exception when calling ConsentApi.ConsentVerify: " + e.Message);
                Debug.Print("Status Code: " + e.ErrorCode);
                Debug.Print(e.StackTrace);
            }
        }
    }
}
```

#### Using the ConsentVerifyWithHttpInfo variant
This returns an ApiResponse object which contains the response data, status code and headers.

```csharp
try
{
    // Single-identifier consent verification
    ApiResponse<VerifyResponse> response = apiInstance.ConsentVerifyWithHttpInfo(propertyId, dataPrincipalIdentifier, identifierType, purposeCode);
    Debug.Write("Status Code: " + response.StatusCode);
    Debug.Write("Response Headers: " + response.Headers);
    Debug.Write("Response Body: " + response.Data);
}
catch (ApiException e)
{
    Debug.Print("Exception when calling ConsentApi.ConsentVerifyWithHttpInfo: " + e.Message);
    Debug.Print("Status Code: " + e.ErrorCode);
    Debug.Print(e.StackTrace);
}
```

### Parameters

| Name | Type | Description | Notes |
|------|------|-------------|-------|
| **propertyId** | **Guid** |  |  |
| **dataPrincipalIdentifier** | **string** | Caller&#39;s identifier for the data principal (email, phone, PAN, etc.). Hashed server-side; never stored. |  |
| **identifierType** | **string** | Determines normalisation rule: email&#x3D;trim+lowercase; phone/aadhaar&#x3D;digits only; pan&#x3D;trim+uppercase; custom&#x3D;trim. Callers MUST use the same type at record-time and verify-time. |  |
| **purposeCode** | **string** |  |  |

### Return type

[**VerifyResponse**](VerifyResponse.md)

### Authorization

[bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json, application/problem+json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Verification envelope. |  -  |
| **401** | Missing, malformed, or invalid API key. |  -  |
| **403** | Key is valid but lacks the read:consent scope. |  -  |
| **404** | property_id does not belong to the key&#39;s org. |  -  |
| **410** | API key has been revoked. |  -  |
| **422** | Missing query param / empty identifier / unknown identifier_type. |  -  |
| **429** | Rate limit exceeded. |  * Retry-After - Seconds until the rate-limit window resets. <br>  * X-RateLimit-Limit - Requests allowed per hour for this key&#39;s tier. <br>  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

<a id="consentverifybatch"></a>
# **ConsentVerifyBatch**
> VerifyBatchResponse ConsentVerifyBatch (VerifyBatchRequest verifyBatchRequest)

Batched consent verification

Same semantics as GET /consent/verify but accepts up to 10,000 identifiers in a single call, all sharing the same property_id, identifier_type, and purpose_code. Response preserves input order. All-or-nothing: if any identifier fails normalisation (empty / unknown type), the entire call returns 422. 

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
    public class ConsentVerifyBatchExample
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
            var apiInstance = new ConsentApi(httpClient, config, httpClientHandler);
            var verifyBatchRequest = new VerifyBatchRequest(); // VerifyBatchRequest | 

            try
            {
                // Batched consent verification
                VerifyBatchResponse result = apiInstance.ConsentVerifyBatch(verifyBatchRequest);
                Debug.WriteLine(result);
            }
            catch (ApiException  e)
            {
                Debug.Print("Exception when calling ConsentApi.ConsentVerifyBatch: " + e.Message);
                Debug.Print("Status Code: " + e.ErrorCode);
                Debug.Print(e.StackTrace);
            }
        }
    }
}
```

#### Using the ConsentVerifyBatchWithHttpInfo variant
This returns an ApiResponse object which contains the response data, status code and headers.

```csharp
try
{
    // Batched consent verification
    ApiResponse<VerifyBatchResponse> response = apiInstance.ConsentVerifyBatchWithHttpInfo(verifyBatchRequest);
    Debug.Write("Status Code: " + response.StatusCode);
    Debug.Write("Response Headers: " + response.Headers);
    Debug.Write("Response Body: " + response.Data);
}
catch (ApiException e)
{
    Debug.Print("Exception when calling ConsentApi.ConsentVerifyBatchWithHttpInfo: " + e.Message);
    Debug.Print("Status Code: " + e.ErrorCode);
    Debug.Print(e.StackTrace);
}
```

### Parameters

| Name | Type | Description | Notes |
|------|------|-------------|-------|
| **verifyBatchRequest** | [**VerifyBatchRequest**](VerifyBatchRequest.md) |  |  |

### Return type

[**VerifyBatchResponse**](VerifyBatchResponse.md)

### Authorization

[bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json, application/problem+json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Batch verification envelope. |  -  |
| **401** | Missing, malformed, or invalid API key. |  -  |
| **403** | Key is valid but lacks the read:consent scope. |  -  |
| **404** | property_id does not belong to the key&#39;s org. |  -  |
| **410** | API key has been revoked. |  -  |
| **413** | identifiers array exceeds 10000 elements. |  -  |
| **422** | Missing body field / empty identifiers / malformed individual identifier / unknown identifier_type. |  -  |
| **429** | Rate limit exceeded. |  * Retry-After - Seconds until the rate-limit window resets. <br>  * X-RateLimit-Limit - Requests allowed per hour for this key&#39;s tier. <br>  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

