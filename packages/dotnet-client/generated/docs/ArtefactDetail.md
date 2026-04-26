# ConsentShield.Client.Model.ArtefactDetail

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**ArtefactId** | **string** |  | 
**PropertyId** | **Guid** |  | 
**PurposeCode** | **string** |  | 
**PurposeDefinitionId** | **Guid** |  | [optional] 
**DataScope** | **List&lt;string&gt;** |  | [optional] 
**Framework** | **string** |  | [optional] 
**Status** | **string** |  | 
**ExpiresAt** | **DateTimeOffset** |  | [optional] 
**RevokedAt** | **DateTimeOffset** |  | [optional] 
**RevocationRecordId** | **Guid** |  | [optional] 
**ReplacedBy** | **string** |  | [optional] 
**IdentifierType** | **string** |  | [optional] 
**CreatedAt** | **DateTimeOffset** |  | 
**Revocation** | [**ArtefactRevocation**](ArtefactRevocation.md) |  | 
**ReplacementChain** | **List&lt;string&gt;** | All artefact_ids in this replacement chain in chronological order (earliest to latest). Single-element array when the artefact has no predecessors or successors. | 

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)

