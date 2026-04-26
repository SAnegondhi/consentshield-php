# # DeletionTriggerRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**property_id** | **string** |  |
**data_principal_identifier** | **string** |  |
**identifier_type** | **string** |  |
**reason** | **string** | &#x60;consent_revoked&#x60; requires purpose_codes; &#x60;erasure_request&#x60; sweeps all active artefacts for the principal; &#x60;retention_expired&#x60; is not yet implemented (returns 501). |
**purpose_codes** | **string[]** | Required when reason&#x3D;consent_revoked. | [optional]
**scope_override** | **string[]** | Optional data-scope override for retention_expired (future). | [optional]
**actor_type** | **string** |  | [optional]
**actor_ref** | **string** |  | [optional]

[[Back to Model list]](../../README.md#models) [[Back to API list]](../../README.md#endpoints) [[Back to README]](../../README.md)
