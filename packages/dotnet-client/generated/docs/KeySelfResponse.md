# ConsentShield.Client.Model.KeySelfResponse

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**KeyId** | **Guid** |  | 
**AccountId** | **Guid** |  | 
**OrgId** | **Guid?** | null for account-scoped keys. | [optional] 
**Name** | **string** |  | 
**KeyPrefix** | **string** | First 16 characters of the key, shown in the dashboard. | 
**Scopes** | **List&lt;string&gt;** |  | 
**RateTier** | **string** |  | 
**CreatedAt** | **DateTimeOffset** |  | 
**LastRotatedAt** | **DateTimeOffset?** |  | [optional] 
**ExpiresAt** | **DateTimeOffset?** |  | [optional] 
**RevokedAt** | **DateTimeOffset?** | Always null on a successful response — revoked keys are rejected at the Bearer layer (410 Gone) before this endpoint runs. | [optional] 

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)

