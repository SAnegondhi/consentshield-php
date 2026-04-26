# # RightsRequestCreatedResponse

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **string** |  |
**status** | **string** |  |
**request_type** | **string** |  |
**captured_via** | **string** |  |
**identity_verified** | **bool** | Always true on a successful response (API caller attests). |
**identity_verified_by** | **string** |  |
**sla_deadline** | **\DateTime** | 30 days from creation per DPDP §11 default. Customer may override. |
**created_at** | **\DateTime** |  |

[[Back to Model list]](../../README.md#models) [[Back to API list]](../../README.md#endpoints) [[Back to README]](../../README.md)
