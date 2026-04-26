

# RecordResponse


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**eventId** | **UUID** |  |  |
|**createdAt** | **OffsetDateTime** |  |  |
|**artefactIds** | [**List&lt;RecordedArtefact&gt;**](RecordedArtefact.md) |  |  |
|**idempotentReplay** | **Boolean** | true when this response is a replay of an earlier call made with the same client_request_id. |  |


## Implemented Interfaces

* Serializable


