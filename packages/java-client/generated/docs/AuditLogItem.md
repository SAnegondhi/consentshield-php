

# AuditLogItem

ip_address is deliberately excluded from this envelope — it is PII and not emitted to the /v1/audit surface. Correlate via actor_email if per-person attribution is needed. 

## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**id** | **UUID** |  |  |
|**actorId** | **UUID** |  |  [optional] |
|**actorEmail** | **String** |  |  [optional] |
|**eventType** | **String** |  |  |
|**entityType** | **String** |  |  [optional] |
|**entityId** | **UUID** |  |  [optional] |
|**payload** | **Object** |  |  [optional] |
|**createdAt** | **OffsetDateTime** |  |  |


## Implemented Interfaces

* Serializable


