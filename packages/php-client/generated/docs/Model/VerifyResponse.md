# # VerifyResponse

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**property_id** | **string** |  |
**identifier_type** | **string** |  |
**purpose_code** | **string** |  |
**status** | **string** |  |
**active_artefact_id** | **string** | Present only when status&#x3D;granted. Opaque identifier. | [optional]
**revoked_at** | **\DateTime** | Present only when status&#x3D;revoked. | [optional]
**revocation_record_id** | **string** | Pointer to artefact_revocations row. Present only when status&#x3D;revoked. | [optional]
**expires_at** | **\DateTime** | Artefact expiry timestamp. Null for never_consented. | [optional]
**evaluated_at** | **\DateTime** | Server-side ISO 8601 timestamp at which this verification was computed. |

[[Back to Model list]](../../README.md#models) [[Back to API list]](../../README.md#endpoints) [[Back to README]](../../README.md)
