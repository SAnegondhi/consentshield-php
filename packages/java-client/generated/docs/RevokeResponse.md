

# RevokeResponse


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**artefactId** | **String** |  |  |
|**status** | [**StatusEnum**](#StatusEnum) |  |  |
|**revocationRecordId** | **UUID** |  |  |
|**idempotentReplay** | **Boolean** | true when the artefact was already revoked and this response is a replay of the original revocation. |  |



## Enum: StatusEnum

| Name | Value |
|---- | -----|
| REVOKED | &quot;revoked&quot; |


## Implemented Interfaces

* Serializable


