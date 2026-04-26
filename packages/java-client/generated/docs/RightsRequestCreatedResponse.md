

# RightsRequestCreatedResponse


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**id** | **UUID** |  |  |
|**status** | [**StatusEnum**](#StatusEnum) |  |  |
|**requestType** | [**RequestTypeEnum**](#RequestTypeEnum) |  |  |
|**capturedVia** | [**CapturedViaEnum**](#CapturedViaEnum) |  |  |
|**identityVerified** | **Boolean** | Always true on a successful response (API caller attests). |  |
|**identityVerifiedBy** | **String** |  |  |
|**slaDeadline** | **OffsetDateTime** | 30 days from creation per DPDP §11 default. Customer may override. |  |
|**createdAt** | **OffsetDateTime** |  |  |



## Enum: StatusEnum

| Name | Value |
|---- | -----|
| NEW | &quot;new&quot; |
| IN_PROGRESS | &quot;in_progress&quot; |
| COMPLETED | &quot;completed&quot; |
| REJECTED | &quot;rejected&quot; |



## Enum: RequestTypeEnum

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


