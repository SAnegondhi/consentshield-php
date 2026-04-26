# ConsentShield.Client.Model.RightsRequestCreateRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Type** | **string** | DPDP §11 rights-request type. | 
**RequestorName** | **string** | Full name of the data principal (trimmed server-side). | 
**RequestorEmail** | **string** | Email address of the data principal (lower-cased server-side). | 
**RequestDetails** | **string** | Optional free-text details captured from the requestor. | [optional] 
**IdentityVerifiedBy** | **string** | Free-text attestation from the API caller describing how the data principal&#39;s identity was verified. Examples: \&quot;internal_kyc_check\&quot;, \&quot;branch_officer_id_42\&quot;, \&quot;existing_session_uid_abc123\&quot;. Stored on the rights_requests row as identity_method and echoed in the created_via_api audit event.  | 
**CapturedVia** | **string** | Channel through which the request was captured. Defaults to api. Operator-side channels (branch, kiosk, call_center) are allowed so the same API key can be used for in-person capture without losing the audit trail of where the request came from.  | [optional] [default to CapturedViaEnum.Api]

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)

