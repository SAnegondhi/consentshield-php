

# DeletionTriggerRequest


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**propertyId** | **UUID** |  |  |
|**dataPrincipalIdentifier** | **String** |  |  |
|**identifierType** | [**IdentifierTypeEnum**](#IdentifierTypeEnum) |  |  |
|**reason** | [**ReasonEnum**](#ReasonEnum) | &#x60;consent_revoked&#x60; requires purpose_codes; &#x60;erasure_request&#x60; sweeps all active artefacts for the principal; &#x60;retention_expired&#x60; is not yet implemented (returns 501). |  |
|**purposeCodes** | **List&lt;String&gt;** | Required when reason&#x3D;consent_revoked. |  [optional] |
|**scopeOverride** | **List&lt;String&gt;** | Optional data-scope override for retention_expired (future). |  [optional] |
|**actorType** | [**ActorTypeEnum**](#ActorTypeEnum) |  |  [optional] |
|**actorRef** | **String** |  |  [optional] |



## Enum: IdentifierTypeEnum

| Name | Value |
|---- | -----|
| EMAIL | &quot;email&quot; |
| PHONE | &quot;phone&quot; |
| PAN | &quot;pan&quot; |
| AADHAAR | &quot;aadhaar&quot; |
| CUSTOM | &quot;custom&quot; |



## Enum: ReasonEnum

| Name | Value |
|---- | -----|
| CONSENT_REVOKED | &quot;consent_revoked&quot; |
| ERASURE_REQUEST | &quot;erasure_request&quot; |
| RETENTION_EXPIRED | &quot;retention_expired&quot; |



## Enum: ActorTypeEnum

| Name | Value |
|---- | -----|
| USER | &quot;user&quot; |
| OPERATOR | &quot;operator&quot; |
| SYSTEM | &quot;system&quot; |


## Implemented Interfaces

* Serializable


