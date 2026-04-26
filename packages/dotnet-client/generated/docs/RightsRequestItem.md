# ConsentShield.Client.Model.RightsRequestItem

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **Guid** |  | 
**RequestType** | **string** |  | 
**RequestorName** | **string** |  | 
**RequestorEmail** | **string** |  | 
**Status** | **string** |  | 
**CapturedVia** | **string** |  | 
**IdentityVerified** | **bool** |  | 
**IdentityVerifiedAt** | **DateTimeOffset?** |  | [optional] 
**IdentityMethod** | **string** |  | [optional] 
**SlaDeadline** | **DateTimeOffset** |  | 
**ResponseSentAt** | **DateTimeOffset?** |  | [optional] 
**CreatedByApiKeyId** | **Guid?** | API key that created this request (non-null when captured_via&#x3D;api). Null for portal-initiated requests.  | [optional] 
**CreatedAt** | **DateTimeOffset** |  | 
**UpdatedAt** | **DateTimeOffset** |  | 

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)

