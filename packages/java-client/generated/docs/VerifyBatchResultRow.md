

# VerifyBatchResultRow


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**identifier** | **String** | Echoed verbatim from input in the same position. |  |
|**status** | [**StatusEnum**](#StatusEnum) |  |  |
|**activeArtefactId** | **String** |  |  [optional] |
|**revokedAt** | **OffsetDateTime** |  |  [optional] |
|**revocationRecordId** | **UUID** |  |  [optional] |
|**expiresAt** | **OffsetDateTime** |  |  [optional] |



## Enum: StatusEnum

| Name | Value |
|---- | -----|
| GRANTED | &quot;granted&quot; |
| REVOKED | &quot;revoked&quot; |
| EXPIRED | &quot;expired&quot; |
| NEVER_CONSENTED | &quot;never_consented&quot; |


## Implemented Interfaces

* Serializable


