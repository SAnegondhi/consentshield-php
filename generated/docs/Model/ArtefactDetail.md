# # ArtefactDetail

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**artefact_id** | **string** |  |
**property_id** | **string** |  |
**purpose_code** | **string** |  |
**purpose_definition_id** | **string** |  | [optional]
**data_scope** | **string[]** |  | [optional]
**framework** | **string** |  | [optional]
**status** | **string** |  |
**expires_at** | **\DateTime** |  | [optional]
**revoked_at** | **\DateTime** |  | [optional]
**revocation_record_id** | **string** |  | [optional]
**replaced_by** | **string** |  | [optional]
**identifier_type** | **string** |  | [optional]
**created_at** | **\DateTime** |  |
**revocation** | [**\ConsentShield\Client\Model\ArtefactRevocation**](ArtefactRevocation.md) |  |
**replacement_chain** | **string[]** | All artefact_ids in this replacement chain in chronological order (earliest to latest). Single-element array when the artefact has no predecessors or successors. |

[[Back to Model list]](../../README.md#models) [[Back to API list]](../../README.md#endpoints) [[Back to README]](../../README.md)
