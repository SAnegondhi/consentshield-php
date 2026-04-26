# ConsentShield.Client.Model.RecordResponse

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**EventId** | **Guid** |  | 
**CreatedAt** | **DateTimeOffset** |  | 
**ArtefactIds** | [**List&lt;RecordedArtefact&gt;**](RecordedArtefact.md) |  | 
**IdempotentReplay** | **bool** | true when this response is a replay of an earlier call made with the same client_request_id. | 

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)

