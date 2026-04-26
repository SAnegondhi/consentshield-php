

# EventListItem


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**id** | **UUID** |  |  |
|**propertyId** | **UUID** |  |  |
|**source** | [**SourceEnum**](#SourceEnum) |  |  |
|**eventType** | **String** |  |  |
|**purposesAcceptedCount** | **Integer** |  |  [optional] |
|**purposesRejectedCount** | **Integer** |  |  [optional] |
|**identifierType** | **String** |  |  [optional] |
|**artefactCount** | **Integer** |  |  [optional] |
|**createdAt** | **OffsetDateTime** |  |  |



## Enum: SourceEnum

| Name | Value |
|---- | -----|
| WEB | &quot;web&quot; |
| API | &quot;api&quot; |
| SDK | &quot;sdk&quot; |


## Implemented Interfaces

* Serializable


