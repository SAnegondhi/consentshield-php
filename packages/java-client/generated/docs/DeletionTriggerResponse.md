

# DeletionTriggerResponse


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**reason** | [**ReasonEnum**](#ReasonEnum) |  |  |
|**revokedArtefactIds** | **List&lt;String&gt;** |  |  |
|**revokedCount** | **Integer** |  |  [optional] |
|**initialStatus** | **String** |  |  |
|**note** | **String** |  |  [optional] |



## Enum: ReasonEnum

| Name | Value |
|---- | -----|
| CONSENT_REVOKED | &quot;consent_revoked&quot; |
| ERASURE_REQUEST | &quot;erasure_request&quot; |
| RETENTION_EXPIRED | &quot;retention_expired&quot; |


## Implemented Interfaces

* Serializable


