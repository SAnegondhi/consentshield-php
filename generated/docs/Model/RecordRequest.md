# # RecordRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**property_id** | **string** |  |
**data_principal_identifier** | **string** | Customer-supplied identifier; hashed server-side and never stored in plaintext. |
**identifier_type** | **string** |  |
**purpose_definition_ids** | **string[]** | Purposes the data principal granted consent for. Each produces an artefact. |
**rejected_purpose_definition_ids** | **string[]** | Optional. Purposes presented but rejected by the data principal. Recorded in consent_events audit row for §11 audit; no artefact is created. | [optional]
**captured_at** | **\DateTime** | When the consent was actually captured (kiosk / call-centre / branch / app). Must be within ±15 minutes of the server&#39;s clock. |
**client_request_id** | **string** | Optional caller-supplied idempotency key. Reuse returns the same envelope instead of creating new rows. | [optional]

[[Back to Model list]](../../README.md#models) [[Back to API list]](../../README.md#endpoints) [[Back to README]](../../README.md)
