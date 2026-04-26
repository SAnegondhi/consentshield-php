# ConsentShield.Client.Model.AuditLogItem
ip_address is deliberately excluded from this envelope — it is PII and not emitted to the /v1/audit surface. Correlate via actor_email if per-person attribution is needed. 

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **Guid** |  | 
**ActorId** | **Guid?** |  | [optional] 
**ActorEmail** | **string** |  | [optional] 
**EventType** | **string** |  | 
**EntityType** | **string** |  | [optional] 
**EntityId** | **Guid?** |  | [optional] 
**Payload** | **Object** |  | [optional] 
**CreatedAt** | **DateTimeOffset** |  | 

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)

