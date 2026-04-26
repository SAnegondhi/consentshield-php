

# VerifyResponse


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**propertyId** | **UUID** |  |  |
|**identifierType** | [**IdentifierTypeEnum**](#IdentifierTypeEnum) |  |  |
|**purposeCode** | **String** |  |  |
|**status** | [**StatusEnum**](#StatusEnum) |  |  |
|**activeArtefactId** | **String** | Present only when status&#x3D;granted. Opaque identifier. |  [optional] |
|**revokedAt** | **OffsetDateTime** | Present only when status&#x3D;revoked. |  [optional] |
|**revocationRecordId** | **UUID** | Pointer to artefact_revocations row. Present only when status&#x3D;revoked. |  [optional] |
|**expiresAt** | **OffsetDateTime** | Artefact expiry timestamp. Null for never_consented. |  [optional] |
|**evaluatedAt** | **OffsetDateTime** | Server-side ISO 8601 timestamp at which this verification was computed. |  |



## Enum: IdentifierTypeEnum

| Name | Value |
|---- | -----|
| EMAIL | &quot;email&quot; |
| PHONE | &quot;phone&quot; |
| PAN | &quot;pan&quot; |
| AADHAAR | &quot;aadhaar&quot; |
| CUSTOM | &quot;custom&quot; |



## Enum: StatusEnum

| Name | Value |
|---- | -----|
| GRANTED | &quot;granted&quot; |
| REVOKED | &quot;revoked&quot; |
| EXPIRED | &quot;expired&quot; |
| NEVER_CONSENTED | &quot;never_consented&quot; |


## Implemented Interfaces

* Serializable


