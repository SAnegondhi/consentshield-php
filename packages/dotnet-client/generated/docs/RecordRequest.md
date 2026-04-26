# ConsentShield.Client.Model.RecordRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**PropertyId** | **Guid** |  | 
**DataPrincipalIdentifier** | **string** | Customer-supplied identifier; hashed server-side and never stored in plaintext. | 
**IdentifierType** | **string** |  | 
**PurposeDefinitionIds** | **List&lt;Guid&gt;** | Purposes the data principal granted consent for. Each produces an artefact. | 
**RejectedPurposeDefinitionIds** | **List&lt;Guid&gt;** | Optional. Purposes presented but rejected by the data principal. Recorded in consent_events audit row for §11 audit; no artefact is created. | [optional] 
**CapturedAt** | **DateTimeOffset** | When the consent was actually captured (kiosk / call-centre / branch / app). Must be within ±15 minutes of the server&#39;s clock. | 
**ClientRequestId** | **string** | Optional caller-supplied idempotency key. Reuse returns the same envelope instead of creating new rows. | [optional] 

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)

