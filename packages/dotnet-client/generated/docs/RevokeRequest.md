# ConsentShield.Client.Model.RevokeRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**ReasonCode** | **string** | Machine-readable reason tag, e.g. user_withdrawal, user_preference_change, business_withdrawal, data_breach, regulatory_instruction. | 
**ReasonNotes** | **string** | Optional free-text notes preserved on the revocation row. | [optional] 
**ActorType** | **string** |  | 
**ActorRef** | **string** | Optional caller-supplied reference (user_id, operator_email, system task id). Stored on the revocation row for §11 audit. | [optional] 

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)

