

# KeySelfResponse


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**keyId** | **UUID** |  |  |
|**accountId** | **UUID** |  |  |
|**orgId** | **UUID** | null for account-scoped keys. |  [optional] |
|**name** | **String** |  |  |
|**keyPrefix** | **String** | First 16 characters of the key, shown in the dashboard. |  |
|**scopes** | **List&lt;String&gt;** |  |  |
|**rateTier** | [**RateTierEnum**](#RateTierEnum) |  |  |
|**createdAt** | **OffsetDateTime** |  |  |
|**lastRotatedAt** | **OffsetDateTime** |  |  [optional] |
|**expiresAt** | **OffsetDateTime** |  |  [optional] |
|**revokedAt** | **OffsetDateTime** | Always null on a successful response — revoked keys are rejected at the Bearer layer (410 Gone) before this endpoint runs. |  [optional] |



## Enum: RateTierEnum

| Name | Value |
|---- | -----|
| STARTER | &quot;starter&quot; |
| GROWTH | &quot;growth&quot; |
| PRO | &quot;pro&quot; |
| ENTERPRISE | &quot;enterprise&quot; |
| SANDBOX | &quot;sandbox&quot; |


## Implemented Interfaces

* Serializable


