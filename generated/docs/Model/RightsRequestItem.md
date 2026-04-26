# # RightsRequestItem

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **string** |  |
**request_type** | **string** |  |
**requestor_name** | **string** |  |
**requestor_email** | **string** |  |
**status** | **string** |  |
**captured_via** | **string** |  |
**identity_verified** | **bool** |  |
**identity_verified_at** | **\DateTime** |  | [optional]
**identity_method** | **string** |  | [optional]
**sla_deadline** | **\DateTime** |  |
**response_sent_at** | **\DateTime** |  | [optional]
**created_by_api_key_id** | **string** | API key that created this request (non-null when captured_via&#x3D;api). Null for portal-initiated requests. | [optional]
**created_at** | **\DateTime** |  |
**updated_at** | **\DateTime** |  |

[[Back to Model list]](../../README.md#models) [[Back to API list]](../../README.md#endpoints) [[Back to README]](../../README.md)
