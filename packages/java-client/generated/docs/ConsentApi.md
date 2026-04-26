# ConsentApi

All URIs are relative to *https://api.consentshield.in/v1*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**consentArtefactGet**](ConsentApi.md#consentArtefactGet) | **GET** /consent/artefacts/{id} | Get a single consent artefact |
| [**consentArtefactRevoke**](ConsentApi.md#consentArtefactRevoke) | **POST** /consent/artefacts/{id}/revoke | Revoke a consent artefact |
| [**consentArtefactsList**](ConsentApi.md#consentArtefactsList) | **GET** /consent/artefacts | List consent artefacts (cursor-paginated) |
| [**consentEventsList**](ConsentApi.md#consentEventsList) | **GET** /consent/events | List consent events (summary only, cursor-paginated) |
| [**consentRecord**](ConsentApi.md#consentRecord) | **POST** /consent/record | Mode B server-to-server consent capture |
| [**consentVerify**](ConsentApi.md#consentVerify) | **GET** /consent/verify | Single-identifier consent verification |
| [**consentVerifyBatch**](ConsentApi.md#consentVerifyBatch) | **POST** /consent/verify/batch | Batched consent verification |


<a id="consentArtefactGet"></a>
# **consentArtefactGet**
> ArtefactDetail consentArtefactGet(id)

Get a single consent artefact

Returns the artefact envelope + revocation record (if any) + full replacement chain in chronological order. 

### Example
```java
// Import classes:
import com.consentshield.sdk.invoker.ApiClient;
import com.consentshield.sdk.invoker.ApiException;
import com.consentshield.sdk.invoker.Configuration;
import com.consentshield.sdk.invoker.auth.*;
import com.consentshield.sdk.invoker.models.*;
import com.consentshield.sdk.api.ConsentApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("https://api.consentshield.in/v1");
    
    // Configure HTTP bearer authorization: bearerAuth
    HttpBearerAuth bearerAuth = (HttpBearerAuth) defaultClient.getAuthentication("bearerAuth");
    bearerAuth.setBearerToken("BEARER TOKEN");

    ConsentApi apiInstance = new ConsentApi(defaultClient);
    String id = "id_example"; // String | 
    try {
      ArtefactDetail result = apiInstance.consentArtefactGet(id);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling ConsentApi#consentArtefactGet");
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
| **id** | **String**|  | |

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

<a id="consentArtefactRevoke"></a>
# **consentArtefactRevoke**
> RevokeResponse consentArtefactRevoke(id, revokeRequest)

Revoke a consent artefact

Records a revocation event for the artefact. The ADR-0022 cascade trigger flips consent_artefacts.status to &#x60;revoked&#x60; and updates the consent_artefact_index. Idempotent — calling revoke on an already- revoked artefact returns 200 with the existing revocation_record_id. Terminal states (&#x60;expired&#x60;, &#x60;replaced&#x60;) cannot be revoked and return 409. 

### Example
```java
// Import classes:
import com.consentshield.sdk.invoker.ApiClient;
import com.consentshield.sdk.invoker.ApiException;
import com.consentshield.sdk.invoker.Configuration;
import com.consentshield.sdk.invoker.auth.*;
import com.consentshield.sdk.invoker.models.*;
import com.consentshield.sdk.api.ConsentApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("https://api.consentshield.in/v1");
    
    // Configure HTTP bearer authorization: bearerAuth
    HttpBearerAuth bearerAuth = (HttpBearerAuth) defaultClient.getAuthentication("bearerAuth");
    bearerAuth.setBearerToken("BEARER TOKEN");

    ConsentApi apiInstance = new ConsentApi(defaultClient);
    String id = "id_example"; // String | 
    RevokeRequest revokeRequest = new RevokeRequest(); // RevokeRequest | 
    try {
      RevokeResponse result = apiInstance.consentArtefactRevoke(id, revokeRequest);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling ConsentApi#consentArtefactRevoke");
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
| **id** | **String**|  | |
| **revokeRequest** | [**RevokeRequest**](RevokeRequest.md)|  | |

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

<a id="consentArtefactsList"></a>
# **consentArtefactsList**
> ArtefactListResponse consentArtefactsList(propertyId, dataPrincipalIdentifier, identifierType, status, purposeCode, expiresBefore, expiresAfter, cursor, limit)

List consent artefacts (cursor-paginated)

Returns artefacts for the key&#39;s org with keyset pagination and optional filters. &#x60;data_principal_identifier&#x60; + &#x60;identifier_type&#x60; must be supplied together to filter by identity. 

### Example
```java
// Import classes:
import com.consentshield.sdk.invoker.ApiClient;
import com.consentshield.sdk.invoker.ApiException;
import com.consentshield.sdk.invoker.Configuration;
import com.consentshield.sdk.invoker.auth.*;
import com.consentshield.sdk.invoker.models.*;
import com.consentshield.sdk.api.ConsentApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("https://api.consentshield.in/v1");
    
    // Configure HTTP bearer authorization: bearerAuth
    HttpBearerAuth bearerAuth = (HttpBearerAuth) defaultClient.getAuthentication("bearerAuth");
    bearerAuth.setBearerToken("BEARER TOKEN");

    ConsentApi apiInstance = new ConsentApi(defaultClient);
    UUID propertyId = UUID.randomUUID(); // UUID | 
    String dataPrincipalIdentifier = "dataPrincipalIdentifier_example"; // String | 
    String identifierType = "email"; // String | 
    String status = "active"; // String | 
    String purposeCode = "purposeCode_example"; // String | 
    OffsetDateTime expiresBefore = OffsetDateTime.now(); // OffsetDateTime | 
    OffsetDateTime expiresAfter = OffsetDateTime.now(); // OffsetDateTime | 
    String cursor = "cursor_example"; // String | 
    Integer limit = 50; // Integer | 
    try {
      ArtefactListResponse result = apiInstance.consentArtefactsList(propertyId, dataPrincipalIdentifier, identifierType, status, purposeCode, expiresBefore, expiresAfter, cursor, limit);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling ConsentApi#consentArtefactsList");
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
| **propertyId** | **UUID**|  | [optional] |
| **dataPrincipalIdentifier** | **String**|  | [optional] |
| **identifierType** | **String**|  | [optional] [enum: email, phone, pan, aadhaar, custom] |
| **status** | **String**|  | [optional] [enum: active, revoked, expired, replaced] |
| **purposeCode** | **String**|  | [optional] |
| **expiresBefore** | **OffsetDateTime**|  | [optional] |
| **expiresAfter** | **OffsetDateTime**|  | [optional] |
| **cursor** | **String**|  | [optional] |
| **limit** | **Integer**|  | [optional] [default to 50] |

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

<a id="consentEventsList"></a>
# **consentEventsList**
> EventListResponse consentEventsList(propertyId, createdAfter, createdBefore, source, cursor, limit)

List consent events (summary only, cursor-paginated)

Returns paginated summaries (counts, not full payloads) of consent_events rows. Use for §11 audit timelines. 

### Example
```java
// Import classes:
import com.consentshield.sdk.invoker.ApiClient;
import com.consentshield.sdk.invoker.ApiException;
import com.consentshield.sdk.invoker.Configuration;
import com.consentshield.sdk.invoker.auth.*;
import com.consentshield.sdk.invoker.models.*;
import com.consentshield.sdk.api.ConsentApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("https://api.consentshield.in/v1");
    
    // Configure HTTP bearer authorization: bearerAuth
    HttpBearerAuth bearerAuth = (HttpBearerAuth) defaultClient.getAuthentication("bearerAuth");
    bearerAuth.setBearerToken("BEARER TOKEN");

    ConsentApi apiInstance = new ConsentApi(defaultClient);
    UUID propertyId = UUID.randomUUID(); // UUID | 
    OffsetDateTime createdAfter = OffsetDateTime.now(); // OffsetDateTime | 
    OffsetDateTime createdBefore = OffsetDateTime.now(); // OffsetDateTime | 
    String source = "web"; // String | 
    String cursor = "cursor_example"; // String | 
    Integer limit = 50; // Integer | 
    try {
      EventListResponse result = apiInstance.consentEventsList(propertyId, createdAfter, createdBefore, source, cursor, limit);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling ConsentApi#consentEventsList");
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
| **propertyId** | **UUID**|  | [optional] |
| **createdAfter** | **OffsetDateTime**|  | [optional] |
| **createdBefore** | **OffsetDateTime**|  | [optional] |
| **source** | **String**|  | [optional] [enum: web, api, sdk] |
| **cursor** | **String**|  | [optional] |
| **limit** | **Integer**|  | [optional] [default to 50] |

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

<a id="consentRecord"></a>
# **consentRecord**
> RecordResponse consentRecord(recordRequest)

Mode B server-to-server consent capture

Records a consent event captured outside the browser (mobile app, call-centre, branch, kiosk, in-person) and issues one artefact per granted purpose. Use client_request_id for safe retries. 

### Example
```java
// Import classes:
import com.consentshield.sdk.invoker.ApiClient;
import com.consentshield.sdk.invoker.ApiException;
import com.consentshield.sdk.invoker.Configuration;
import com.consentshield.sdk.invoker.auth.*;
import com.consentshield.sdk.invoker.models.*;
import com.consentshield.sdk.api.ConsentApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("https://api.consentshield.in/v1");
    
    // Configure HTTP bearer authorization: bearerAuth
    HttpBearerAuth bearerAuth = (HttpBearerAuth) defaultClient.getAuthentication("bearerAuth");
    bearerAuth.setBearerToken("BEARER TOKEN");

    ConsentApi apiInstance = new ConsentApi(defaultClient);
    RecordRequest recordRequest = new RecordRequest(); // RecordRequest | 
    try {
      RecordResponse result = apiInstance.consentRecord(recordRequest);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling ConsentApi#consentRecord");
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
| **recordRequest** | [**RecordRequest**](RecordRequest.md)|  | |

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

<a id="consentVerify"></a>
# **consentVerify**
> VerifyResponse consentVerify(propertyId, dataPrincipalIdentifier, identifierType, purposeCode)

Single-identifier consent verification

DPDP §6 runtime check. Given a data principal identifier, property, and purpose code, returns whether consent is currently granted, revoked, expired, or never recorded. Identifier is hashed server-side with the org&#39;s per-org salt — plaintext is never stored. 

### Example
```java
// Import classes:
import com.consentshield.sdk.invoker.ApiClient;
import com.consentshield.sdk.invoker.ApiException;
import com.consentshield.sdk.invoker.Configuration;
import com.consentshield.sdk.invoker.auth.*;
import com.consentshield.sdk.invoker.models.*;
import com.consentshield.sdk.api.ConsentApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("https://api.consentshield.in/v1");
    
    // Configure HTTP bearer authorization: bearerAuth
    HttpBearerAuth bearerAuth = (HttpBearerAuth) defaultClient.getAuthentication("bearerAuth");
    bearerAuth.setBearerToken("BEARER TOKEN");

    ConsentApi apiInstance = new ConsentApi(defaultClient);
    UUID propertyId = UUID.randomUUID(); // UUID | 
    String dataPrincipalIdentifier = "dataPrincipalIdentifier_example"; // String | Caller's identifier for the data principal (email, phone, PAN, etc.). Hashed server-side; never stored.
    String identifierType = "email"; // String | Determines normalisation rule: email=trim+lowercase; phone/aadhaar=digits only; pan=trim+uppercase; custom=trim. Callers MUST use the same type at record-time and verify-time.
    String purposeCode = "purposeCode_example"; // String | 
    try {
      VerifyResponse result = apiInstance.consentVerify(propertyId, dataPrincipalIdentifier, identifierType, purposeCode);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling ConsentApi#consentVerify");
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
| **propertyId** | **UUID**|  | |
| **dataPrincipalIdentifier** | **String**| Caller&#39;s identifier for the data principal (email, phone, PAN, etc.). Hashed server-side; never stored. | |
| **identifierType** | **String**| Determines normalisation rule: email&#x3D;trim+lowercase; phone/aadhaar&#x3D;digits only; pan&#x3D;trim+uppercase; custom&#x3D;trim. Callers MUST use the same type at record-time and verify-time. | [enum: email, phone, pan, aadhaar, custom] |
| **purposeCode** | **String**|  | |

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

<a id="consentVerifyBatch"></a>
# **consentVerifyBatch**
> VerifyBatchResponse consentVerifyBatch(verifyBatchRequest)

Batched consent verification

Same semantics as GET /consent/verify but accepts up to 10,000 identifiers in a single call, all sharing the same property_id, identifier_type, and purpose_code. Response preserves input order. All-or-nothing: if any identifier fails normalisation (empty / unknown type), the entire call returns 422. 

### Example
```java
// Import classes:
import com.consentshield.sdk.invoker.ApiClient;
import com.consentshield.sdk.invoker.ApiException;
import com.consentshield.sdk.invoker.Configuration;
import com.consentshield.sdk.invoker.auth.*;
import com.consentshield.sdk.invoker.models.*;
import com.consentshield.sdk.api.ConsentApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("https://api.consentshield.in/v1");
    
    // Configure HTTP bearer authorization: bearerAuth
    HttpBearerAuth bearerAuth = (HttpBearerAuth) defaultClient.getAuthentication("bearerAuth");
    bearerAuth.setBearerToken("BEARER TOKEN");

    ConsentApi apiInstance = new ConsentApi(defaultClient);
    VerifyBatchRequest verifyBatchRequest = new VerifyBatchRequest(); // VerifyBatchRequest | 
    try {
      VerifyBatchResponse result = apiInstance.consentVerifyBatch(verifyBatchRequest);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling ConsentApi#consentVerifyBatch");
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
| **verifyBatchRequest** | [**VerifyBatchRequest**](VerifyBatchRequest.md)|  | |

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

