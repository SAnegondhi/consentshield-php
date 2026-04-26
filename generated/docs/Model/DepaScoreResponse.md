# # DepaScoreResponse

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**total_score** | **float** | Sum of the four dimension scores. Null until nightly cron has run for this org. | [optional]
**coverage_score** | **float** |  | [optional]
**expiry_score** | **float** |  | [optional]
**freshness_score** | **float** |  | [optional]
**revocation_score** | **float** |  | [optional]
**computed_at** | **\DateTime** | When the metrics were last refreshed. Dashboard warns if &gt;25h old. | [optional]
**max_score** | **int** | Fixed upper bound (4 dimensions × 5 points). Divide total_score by this for a 0..1 ratio. |

[[Back to Model list]](../../README.md#models) [[Back to API list]](../../README.md#endpoints) [[Back to README]](../../README.md)
