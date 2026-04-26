

# RightsRequestCreateRequest


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**type** | [**TypeEnum**](#TypeEnum) | DPDP §11 rights-request type. |  |
|**requestorName** | **String** | Full name of the data principal (trimmed server-side). |  |
|**requestorEmail** | **String** | Email address of the data principal (lower-cased server-side). |  |
|**requestDetails** | **String** | Optional free-text details captured from the requestor. |  [optional] |
|**identityVerifiedBy** | **String** | Free-text attestation from the API caller describing how the data principal&#39;s identity was verified. Examples: \&quot;internal_kyc_check\&quot;, \&quot;branch_officer_id_42\&quot;, \&quot;existing_session_uid_abc123\&quot;. Stored on the rights_requests row as identity_method and echoed in the created_via_api audit event.  |  |
|**capturedVia** | [**CapturedViaEnum**](#CapturedViaEnum) | Channel through which the request was captured. Defaults to api. Operator-side channels (branch, kiosk, call_center) are allowed so the same API key can be used for in-person capture without losing the audit trail of where the request came from.  |  [optional] |



## Enum: TypeEnum

| Name | Value |
|---- | -----|
| ERASURE | &quot;erasure&quot; |
| ACCESS | &quot;access&quot; |
| CORRECTION | &quot;correction&quot; |
| NOMINATION | &quot;nomination&quot; |



## Enum: CapturedViaEnum

| Name | Value |
|---- | -----|
| API | &quot;api&quot; |
| KIOSK | &quot;kiosk&quot; |
| BRANCH | &quot;branch&quot; |
| CALL_CENTER | &quot;call_center&quot; |
| MOBILE_APP | &quot;mobile_app&quot; |
| EMAIL | &quot;email&quot; |
| OTHER | &quot;other&quot; |


## Implemented Interfaces

* Serializable


