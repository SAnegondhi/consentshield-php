

# RecordRequest


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**propertyId** | **UUID** |  |  |
|**dataPrincipalIdentifier** | **String** | Customer-supplied identifier; hashed server-side and never stored in plaintext. |  |
|**identifierType** | [**IdentifierTypeEnum**](#IdentifierTypeEnum) |  |  |
|**purposeDefinitionIds** | **List&lt;UUID&gt;** | Purposes the data principal granted consent for. Each produces an artefact. |  |
|**rejectedPurposeDefinitionIds** | **List&lt;UUID&gt;** | Optional. Purposes presented but rejected by the data principal. Recorded in consent_events audit row for §11 audit; no artefact is created. |  [optional] |
|**capturedAt** | **OffsetDateTime** | When the consent was actually captured (kiosk / call-centre / branch / app). Must be within ±15 minutes of the server&#39;s clock. |  |
|**clientRequestId** | **String** | Optional caller-supplied idempotency key. Reuse returns the same envelope instead of creating new rows. |  [optional] |



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


