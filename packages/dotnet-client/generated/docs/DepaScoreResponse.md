# ConsentShield.Client.Model.DepaScoreResponse

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**TotalScore** | **decimal?** | Sum of the four dimension scores. Null until nightly cron has run for this org. | [optional] 
**CoverageScore** | **decimal?** |  | [optional] 
**ExpiryScore** | **decimal?** |  | [optional] 
**FreshnessScore** | **decimal?** |  | [optional] 
**RevocationScore** | **decimal?** |  | [optional] 
**ComputedAt** | **DateTimeOffset?** | When the metrics were last refreshed. Dashboard warns if &gt;25h old. | [optional] 
**MaxScore** | **int** | Fixed upper bound (4 dimensions × 5 points). Divide total_score by this for a 0..1 ratio. | 

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)

