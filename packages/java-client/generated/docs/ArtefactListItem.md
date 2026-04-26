

# ArtefactListItem


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**artefactId** | **String** |  |  |
|**propertyId** | **UUID** |  |  |
|**purposeCode** | **String** |  |  |
|**purposeDefinitionId** | **UUID** |  |  [optional] |
|**dataScope** | **List&lt;String&gt;** |  |  [optional] |
|**framework** | [**FrameworkEnum**](#FrameworkEnum) |  |  [optional] |
|**status** | [**StatusEnum**](#StatusEnum) |  |  |
|**expiresAt** | **OffsetDateTime** |  |  [optional] |
|**revokedAt** | **OffsetDateTime** |  |  [optional] |
|**revocationRecordId** | **UUID** |  |  [optional] |
|**replacedBy** | **String** |  |  [optional] |
|**identifierType** | [**IdentifierTypeEnum**](#IdentifierTypeEnum) |  |  [optional] |
|**createdAt** | **OffsetDateTime** |  |  |



## Enum: FrameworkEnum

| Name | Value |
|---- | -----|
| DPDP | &quot;dpdp&quot; |
| ABDM | &quot;abdm&quot; |
| GDPR | &quot;gdpr&quot; |



## Enum: StatusEnum

| Name | Value |
|---- | -----|
| ACTIVE | &quot;active&quot; |
| REVOKED | &quot;revoked&quot; |
| EXPIRED | &quot;expired&quot; |
| REPLACED | &quot;replaced&quot; |



## Enum: IdentifierTypeEnum

| Name | Value |
|---- | -----|
| EMAIL | &quot;email&quot; |
| PHONE | &quot;phone&quot; |
| PAN | &quot;pan&quot; |
| AADHAAR | &quot;aadhaar&quot; |
| CUSTOM | &quot;custom&quot; |


## Implemented Interfaces

* Serializable


