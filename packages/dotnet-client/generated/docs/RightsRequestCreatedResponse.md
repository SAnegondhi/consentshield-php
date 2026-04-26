# ConsentShield.Client.Model.RightsRequestCreatedResponse

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **Guid** |  | 
**Status** | **string** |  | 
**RequestType** | **string** |  | 
**CapturedVia** | **string** |  | 
**IdentityVerified** | **bool** | Always true on a successful response (API caller attests). | 
**IdentityVerifiedBy** | **string** |  | 
**SlaDeadline** | **DateTimeOffset** | 30 days from creation per DPDP §11 default. Customer may override. | 
**CreatedAt** | **DateTimeOffset** |  | 

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)

