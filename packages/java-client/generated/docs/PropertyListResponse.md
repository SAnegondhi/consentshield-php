

# PropertyListResponse


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**items** | [**List&lt;PropertyItem&gt;**](PropertyItem.md) | Ordered by created_at asc. The HMAC &#x60;event_signing_secret&#x60; is deliberately omitted — it&#39;s a server-only key used by the Cloudflare Worker to verify inbound events and must never leak to API consumers.  |  |


## Implemented Interfaces

* Serializable


