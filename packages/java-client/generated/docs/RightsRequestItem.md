

# RightsRequestItem


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**id** | **UUID** |  |  |
|**requestType** | [**RequestTypeEnum**](#RequestTypeEnum) |  |  |
|**requestorName** | **String** |  |  |
|**requestorEmail** | **String** |  |  |
|**status** | [**StatusEnum**](#StatusEnum) |  |  |
|**capturedVia** | [**CapturedViaEnum**](#CapturedViaEnum) |  |  |
|**identityVerified** | **Boolean** |  |  |
|**identityVerifiedAt** | **OffsetDateTime** |  |  [optional] |
|**identityMethod** | **String** |  |  [optional] |
|**slaDeadline** | **OffsetDateTime** |  |  |
|**responseSentAt** | **OffsetDateTime** |  |  [optional] |
|**createdByApiKeyId** | **UUID** | API key that created this request (non-null when captured_via&#x3D;api). Null for portal-initiated requests.  |  [optional] |
|**createdAt** | **OffsetDateTime** |  |  |
|**updatedAt** | **OffsetDateTime** |  |  |



## Enum: RequestTypeEnum

| Name | Value |
|---- | -----|
| ERASURE | &quot;erasure&quot; |
| ACCESS | &quot;access&quot; |
| CORRECTION | &quot;correction&quot; |
| NOMINATION | &quot;nomination&quot; |



## Enum: StatusEnum

| Name | Value |
|---- | -----|
| NEW | &quot;new&quot; |
| IN_PROGRESS | &quot;in_progress&quot; |
| COMPLETED | &quot;completed&quot; |
| REJECTED | &quot;rejected&quot; |



## Enum: CapturedViaEnum

| Name | Value |
|---- | -----|
| PORTAL | &quot;portal&quot; |
| API | &quot;api&quot; |
| KIOSK | &quot;kiosk&quot; |
| BRANCH | &quot;branch&quot; |
| CALL_CENTER | &quot;call_center&quot; |
| MOBILE_APP | &quot;mobile_app&quot; |
| EMAIL | &quot;email&quot; |
| OTHER | &quot;other&quot; |


## Implemented Interfaces

* Serializable


