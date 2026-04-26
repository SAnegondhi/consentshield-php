# ConsentShield.Client.Model.VerifyResponse

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**PropertyId** | **Guid** |  | 
**IdentifierType** | **string** |  | 
**PurposeCode** | **string** |  | 
**Status** | **string** |  | 
**ActiveArtefactId** | **string** | Present only when status&#x3D;granted. Opaque identifier. | [optional] 
**RevokedAt** | **DateTimeOffset?** | Present only when status&#x3D;revoked. | [optional] 
**RevocationRecordId** | **Guid?** | Pointer to artefact_revocations row. Present only when status&#x3D;revoked. | [optional] 
**ExpiresAt** | **DateTimeOffset?** | Artefact expiry timestamp. Null for never_consented. | [optional] 
**EvaluatedAt** | **DateTimeOffset** | Server-side ISO 8601 timestamp at which this verification was computed. | 

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)

