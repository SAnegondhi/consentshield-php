

# RevokeRequest


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**reasonCode** | **String** | Machine-readable reason tag, e.g. user_withdrawal, user_preference_change, business_withdrawal, data_breach, regulatory_instruction. |  |
|**reasonNotes** | **String** | Optional free-text notes preserved on the revocation row. |  [optional] |
|**actorType** | [**ActorTypeEnum**](#ActorTypeEnum) |  |  |
|**actorRef** | **String** | Optional caller-supplied reference (user_id, operator_email, system task id). Stored on the revocation row for §11 audit. |  [optional] |



## Enum: ActorTypeEnum

| Name | Value |
|---- | -----|
| USER | &quot;user&quot; |
| OPERATOR | &quot;operator&quot; |
| SYSTEM | &quot;system&quot; |


## Implemented Interfaces

* Serializable


