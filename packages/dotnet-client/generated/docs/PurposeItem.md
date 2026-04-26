# ConsentShield.Client.Model.PurposeItem

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **Guid** |  | 
**PurposeCode** | **string** |  | 
**DisplayName** | **string** |  | 
**Description** | **string** |  | [optional] 
**DataScope** | **List&lt;string&gt;** |  | 
**DefaultExpiryDays** | **int** |  | 
**AutoDeleteOnExpiry** | **bool** |  | [optional] 
**IsRequired** | **bool** | Whether this purpose is mandatory (required for the service to function; no opt-out under DPDP). | [optional] 
**Framework** | **string** |  | 
**IsActive** | **bool** |  | 
**CreatedAt** | **DateTimeOffset** |  | 
**UpdatedAt** | **DateTimeOffset** |  | 

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)

