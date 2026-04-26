# ConsentShield.Client.Model.DeletionTriggerRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**PropertyId** | **Guid** |  | 
**DataPrincipalIdentifier** | **string** |  | 
**IdentifierType** | **string** |  | 
**Reason** | **string** | &#x60;consent_revoked&#x60; requires purpose_codes; &#x60;erasure_request&#x60; sweeps all active artefacts for the principal; &#x60;retention_expired&#x60; is not yet implemented (returns 501). | 
**PurposeCodes** | **List&lt;string&gt;** | Required when reason&#x3D;consent_revoked. | [optional] 
**ScopeOverride** | **List&lt;string&gt;** | Optional data-scope override for retention_expired (future). | [optional] 
**ActorType** | **string** |  | [optional] 
**ActorRef** | **string** |  | [optional] 

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)

