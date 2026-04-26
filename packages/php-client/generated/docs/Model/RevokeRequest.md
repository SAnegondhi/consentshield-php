# # RevokeRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**reason_code** | **string** | Machine-readable reason tag, e.g. user_withdrawal, user_preference_change, business_withdrawal, data_breach, regulatory_instruction. |
**reason_notes** | **string** | Optional free-text notes preserved on the revocation row. | [optional]
**actor_type** | **string** |  |
**actor_ref** | **string** | Optional caller-supplied reference (user_id, operator_email, system task id). Stored on the revocation row for §11 audit. | [optional]

[[Back to Model list]](../../README.md#models) [[Back to API list]](../../README.md#endpoints) [[Back to README]](../../README.md)
