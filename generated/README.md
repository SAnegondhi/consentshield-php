# ConsentShield

Bearer-authenticated compliance API for DPDP consent events, rights requests, audit logs, and data deletion. All endpoints require a `cs_live_*` API key issued from the ConsentShield dashboard.



## Installation & Usage

### Requirements

PHP 7.4 and later.
Should also work with PHP 8.0.

### Composer

To install the bindings via [Composer](https://getcomposer.org/), add the following to `composer.json`:

```json
{
  "repositories": [
    {
      "type": "vcs",
      "url": "https://github.com/consentshield-org/php.git"
    }
  ],
  "require": {
    "consentshield-org/php": "*@dev"
  }
}
```

Then run `composer install`

### Manual Installation

Download the files and include `autoload.php`:

```php
<?php
require_once('/path/to/ConsentShield/vendor/autoload.php');
```

## Getting Started

Please follow the [installation procedure](#installation--usage) and then run the following:

```php
<?php
require_once(__DIR__ . '/vendor/autoload.php');



// Configure Bearer (cs_live_<token>) authorization: bearerAuth
$config = ConsentShield\Client\Configuration::getDefaultConfiguration()->setAccessToken('YOUR_ACCESS_TOKEN');


$apiInstance = new ConsentShield\Client\Api\AccountApi(
    // If you want use custom http client, pass your client which implements `GuzzleHttp\ClientInterface`.
    // This is optional, `GuzzleHttp\Client` will be used as default.
    new GuzzleHttp\Client(),
    $config
);

try {
    $result = $apiInstance->keySelf();
    print_r($result);
} catch (Exception $e) {
    echo 'Exception when calling AccountApi->keySelf: ', $e->getMessage(), PHP_EOL;
}

```

## API Endpoints

All URIs are relative to *https://api.consentshield.in/v1*

Class | Method | HTTP request | Description
------------ | ------------- | ------------- | -------------
*AccountApi* | [**keySelf**](docs/Api/AccountApi.md#keyself) | **GET** /keys/self | Introspect the Bearer token&#39;s own metadata
*AccountApi* | [**planList**](docs/Api/AccountApi.md#planlist) | **GET** /plans | List active plans with tier limits + pricing
*AccountApi* | [**propertyList**](docs/Api/AccountApi.md#propertylist) | **GET** /properties | List web properties configured for the caller&#39;s org
*AccountApi* | [**purposeList**](docs/Api/AccountApi.md#purposelist) | **GET** /purposes | List purposes configured for the caller&#39;s org
*AccountApi* | [**usage**](docs/Api/AccountApi.md#usage) | **GET** /usage | Per-day request count + latency for the Bearer token
*AuditApi* | [**auditList**](docs/Api/AuditApi.md#auditlist) | **GET** /audit | List recent audit_log events for the caller&#39;s org
*ConsentApi* | [**consentArtefactGet**](docs/Api/ConsentApi.md#consentartefactget) | **GET** /consent/artefacts/{id} | Get a single consent artefact
*ConsentApi* | [**consentArtefactRevoke**](docs/Api/ConsentApi.md#consentartefactrevoke) | **POST** /consent/artefacts/{id}/revoke | Revoke a consent artefact
*ConsentApi* | [**consentArtefactsList**](docs/Api/ConsentApi.md#consentartefactslist) | **GET** /consent/artefacts | List consent artefacts (cursor-paginated)
*ConsentApi* | [**consentEventsList**](docs/Api/ConsentApi.md#consenteventslist) | **GET** /consent/events | List consent events (summary only, cursor-paginated)
*ConsentApi* | [**consentRecord**](docs/Api/ConsentApi.md#consentrecord) | **POST** /consent/record | Mode B server-to-server consent capture
*ConsentApi* | [**consentVerify**](docs/Api/ConsentApi.md#consentverify) | **GET** /consent/verify | Single-identifier consent verification
*ConsentApi* | [**consentVerifyBatch**](docs/Api/ConsentApi.md#consentverifybatch) | **POST** /consent/verify/batch | Batched consent verification
*DeletionApi* | [**deletionReceiptsList**](docs/Api/DeletionApi.md#deletionreceiptslist) | **GET** /deletion/receipts | List deletion receipts
*DeletionApi* | [**deletionTrigger**](docs/Api/DeletionApi.md#deletiontrigger) | **POST** /deletion/trigger | Trigger deletion orchestration for a data principal
*DeletionApi* | [**integrationsTestDelete**](docs/Api/DeletionApi.md#integrationstestdelete) | **POST** /integrations/{connector_id}/test_delete | Exercise a customer deletion-webhook handler without real data
*RightsApi* | [**rightsRequestCreate**](docs/Api/RightsApi.md#rightsrequestcreate) | **POST** /rights/requests | Create a rights request on behalf of a verified data principal
*RightsApi* | [**rightsRequestList**](docs/Api/RightsApi.md#rightsrequestlist) | **GET** /rights/requests | List rights requests for the caller&#39;s org (cursor-paginated)
*ScoreApi* | [**scoreSelf**](docs/Api/ScoreApi.md#scoreself) | **GET** /score | Current DEPA compliance score for the caller&#39;s org
*SecurityApi* | [**securityScansList**](docs/Api/SecurityApi.md#securityscanslist) | **GET** /security/scans | List recent security-posture scan findings
*UtilityApi* | [**ping**](docs/Api/UtilityApi.md#ping) | **GET** /_ping | Canary health-check

## Models

- [ArtefactDetail](docs/Model/ArtefactDetail.md)
- [ArtefactListItem](docs/Model/ArtefactListItem.md)
- [ArtefactListResponse](docs/Model/ArtefactListResponse.md)
- [ArtefactRevocation](docs/Model/ArtefactRevocation.md)
- [AuditLogItem](docs/Model/AuditLogItem.md)
- [AuditLogListResponse](docs/Model/AuditLogListResponse.md)
- [DeletionReceiptRow](docs/Model/DeletionReceiptRow.md)
- [DeletionReceiptsResponse](docs/Model/DeletionReceiptsResponse.md)
- [DeletionTriggerRequest](docs/Model/DeletionTriggerRequest.md)
- [DeletionTriggerResponse](docs/Model/DeletionTriggerResponse.md)
- [DepaScoreResponse](docs/Model/DepaScoreResponse.md)
- [EventListItem](docs/Model/EventListItem.md)
- [EventListResponse](docs/Model/EventListResponse.md)
- [KeySelfResponse](docs/Model/KeySelfResponse.md)
- [PingResponse](docs/Model/PingResponse.md)
- [PlanItem](docs/Model/PlanItem.md)
- [PlanListResponse](docs/Model/PlanListResponse.md)
- [Problem](docs/Model/Problem.md)
- [PropertyItem](docs/Model/PropertyItem.md)
- [PropertyListResponse](docs/Model/PropertyListResponse.md)
- [PurposeItem](docs/Model/PurposeItem.md)
- [PurposeListResponse](docs/Model/PurposeListResponse.md)
- [RecordRequest](docs/Model/RecordRequest.md)
- [RecordResponse](docs/Model/RecordResponse.md)
- [RecordedArtefact](docs/Model/RecordedArtefact.md)
- [RevokeRequest](docs/Model/RevokeRequest.md)
- [RevokeResponse](docs/Model/RevokeResponse.md)
- [RightsRequestCreateRequest](docs/Model/RightsRequestCreateRequest.md)
- [RightsRequestCreatedResponse](docs/Model/RightsRequestCreatedResponse.md)
- [RightsRequestItem](docs/Model/RightsRequestItem.md)
- [RightsRequestListResponse](docs/Model/RightsRequestListResponse.md)
- [SecurityScanItem](docs/Model/SecurityScanItem.md)
- [SecurityScanListResponse](docs/Model/SecurityScanListResponse.md)
- [TestDeleteResponse](docs/Model/TestDeleteResponse.md)
- [UsageDayRow](docs/Model/UsageDayRow.md)
- [UsageResponse](docs/Model/UsageResponse.md)
- [VerifyBatchRequest](docs/Model/VerifyBatchRequest.md)
- [VerifyBatchResponse](docs/Model/VerifyBatchResponse.md)
- [VerifyBatchResultRow](docs/Model/VerifyBatchResultRow.md)
- [VerifyResponse](docs/Model/VerifyResponse.md)

## Authorization

Authentication schemes defined for the API:
### bearerAuth

- **Type**: Bearer authentication (cs_live_<token>)

## Tests

To run the tests, use:

```bash
composer install
vendor/bin/phpunit
```

## Author

support@consentshield.in

## About this package

This PHP package is automatically generated by the [OpenAPI Generator](https://openapi-generator.tech) project:

- API version: `1.0.0`
    - Package version: `1.0.0`
    - Generator version: `7.10.0`
- Build package: `org.openapitools.codegen.languages.PhpClientCodegen`
