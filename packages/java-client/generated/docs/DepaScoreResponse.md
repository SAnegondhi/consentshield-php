

# DepaScoreResponse


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**totalScore** | **BigDecimal** | Sum of the four dimension scores. Null until nightly cron has run for this org. |  [optional] |
|**coverageScore** | **BigDecimal** |  |  [optional] |
|**expiryScore** | **BigDecimal** |  |  [optional] |
|**freshnessScore** | **BigDecimal** |  |  [optional] |
|**revocationScore** | **BigDecimal** |  |  [optional] |
|**computedAt** | **OffsetDateTime** | When the metrics were last refreshed. Dashboard warns if &gt;25h old. |  [optional] |
|**maxScore** | **Integer** | Fixed upper bound (4 dimensions × 5 points). Divide total_score by this for a 0..1 ratio. |  |


## Implemented Interfaces

* Serializable


