# # KeySelfResponse

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**key_id** | **string** |  |
**account_id** | **string** |  |
**org_id** | **string** | null for account-scoped keys. | [optional]
**name** | **string** |  |
**key_prefix** | **string** | First 16 characters of the key, shown in the dashboard. |
**scopes** | **string[]** |  |
**rate_tier** | **string** |  |
**created_at** | **\DateTime** |  |
**last_rotated_at** | **\DateTime** |  | [optional]
**expires_at** | **\DateTime** |  | [optional]
**revoked_at** | **\DateTime** | Always null on a successful response — revoked keys are rejected at the Bearer layer (410 Gone) before this endpoint runs. | [optional]

[[Back to Model list]](../../README.md#models) [[Back to API list]](../../README.md#endpoints) [[Back to README]](../../README.md)
