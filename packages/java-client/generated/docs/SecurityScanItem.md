

# SecurityScanItem


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**id** | **UUID** |  |  |
|**propertyId** | **UUID** |  |  |
|**scanType** | **String** |  |  |
|**severity** | [**SeverityEnum**](#SeverityEnum) |  |  |
|**signalKey** | **String** |  |  |
|**details** | **Object** |  |  [optional] |
|**remediation** | **String** |  |  [optional] |
|**scannedAt** | **OffsetDateTime** |  |  |
|**createdAt** | **OffsetDateTime** |  |  |



## Enum: SeverityEnum

| Name | Value |
|---- | -----|
| CRITICAL | &quot;critical&quot; |
| HIGH | &quot;high&quot; |
| MEDIUM | &quot;medium&quot; |
| LOW | &quot;low&quot; |
| INFO | &quot;info&quot; |


## Implemented Interfaces

* Serializable


