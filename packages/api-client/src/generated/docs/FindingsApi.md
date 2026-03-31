# FindingsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**findingsControllerBulkUpdate**](FindingsApi.md#findingscontrollerbulkupdate) | **POST** /findings/bulk-update | Bulk update findings |
| [**findingsControllerCreate**](FindingsApi.md#findingscontrollercreate) | **POST** /findings/create | Create a new finding |
| [**findingsControllerFindOne**](FindingsApi.md#findingscontrollerfindone) | **GET** /findings/{id} | Get a finding by ID |
| [**findingsControllerGetDiscoveryOverview**](FindingsApi.md#findingscontrollergetdiscoveryoverview) | **GET** /findings/discovery | Get discovery dashboard overview data |
| [**findingsControllerGetStats**](FindingsApi.md#findingscontrollergetstats) | **GET** /findings/stats | Get finding statistics |
| [**findingsControllerListAssetSummaries**](FindingsApi.md#findingscontrollerlistassetsummaries) | **GET** /findings/assets | List asset finding summaries with optional filters |
| [**findingsControllerUpdate**](FindingsApi.md#findingscontrollerupdate) | **PATCH** /findings/{id} | Update a finding |



## findingsControllerBulkUpdate

> BulkUpdateFindingsResponseDto findingsControllerBulkUpdate(bulkUpdateFindingsDto)

Bulk update findings

Update status, severity, and/or comment on multiple findings at once.

### Example

```ts
import {
  Configuration,
  FindingsApi,
} from '@workspace/api-client';
import type { FindingsControllerBulkUpdateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new FindingsApi();

  const body = {
    // BulkUpdateFindingsDto
    bulkUpdateFindingsDto: ...,
  } satisfies FindingsControllerBulkUpdateRequest;

  try {
    const data = await api.findingsControllerBulkUpdate(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **bulkUpdateFindingsDto** | [BulkUpdateFindingsDto](BulkUpdateFindingsDto.md) |  | |

### Return type

[**BulkUpdateFindingsResponseDto**](BulkUpdateFindingsResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Findings updated successfully |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## findingsControllerCreate

> FindingResponseDto findingsControllerCreate(createFindingDto)

Create a new finding

### Example

```ts
import {
  Configuration,
  FindingsApi,
} from '@workspace/api-client';
import type { FindingsControllerCreateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new FindingsApi();

  const body = {
    // CreateFindingDto
    createFindingDto: ...,
  } satisfies FindingsControllerCreateRequest;

  try {
    const data = await api.findingsControllerCreate(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **createFindingDto** | [CreateFindingDto](CreateFindingDto.md) |  | |

### Return type

[**FindingResponseDto**](FindingResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** | Finding created successfully |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## findingsControllerFindOne

> FindingResponseDto findingsControllerFindOne(id)

Get a finding by ID

### Example

```ts
import {
  Configuration,
  FindingsApi,
} from '@workspace/api-client';
import type { FindingsControllerFindOneRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new FindingsApi();

  const body = {
    // string
    id: id_example,
  } satisfies FindingsControllerFindOneRequest;

  try {
    const data = await api.findingsControllerFindOne(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **id** | `string` |  | [Defaults to `undefined`] |

### Return type

[**FindingResponseDto**](FindingResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Finding found |  -  |
| **404** | Finding not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## findingsControllerGetDiscoveryOverview

> FindingsDiscoveryResponseDto findingsControllerGetDiscoveryOverview(windowDays, includeResolved)

Get discovery dashboard overview data

### Example

```ts
import {
  Configuration,
  FindingsApi,
} from '@workspace/api-client';
import type { FindingsControllerGetDiscoveryOverviewRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new FindingsApi();

  const body = {
    // 7 | 30 | 90 | Number of days to include in the discovery window. (optional)
    windowDays: 8.14,
    // boolean | Include resolved and non-open findings. (optional)
    includeResolved: true,
  } satisfies FindingsControllerGetDiscoveryOverviewRequest;

  try {
    const data = await api.findingsControllerGetDiscoveryOverview(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **windowDays** | `7`, `30`, `90` | Number of days to include in the discovery window. | [Optional] [Defaults to `30`] [Enum: 7, 30, 90] |
| **includeResolved** | `boolean` | Include resolved and non-open findings. | [Optional] [Defaults to `false`] |

### Return type

[**FindingsDiscoveryResponseDto**](FindingsDiscoveryResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Discovery overview payload |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## findingsControllerGetStats

> findingsControllerGetStats(sourceId)

Get finding statistics

### Example

```ts
import {
  Configuration,
  FindingsApi,
} from '@workspace/api-client';
import type { FindingsControllerGetStatsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new FindingsApi();

  const body = {
    // string (optional)
    sourceId: sourceId_example,
  } satisfies FindingsControllerGetStatsRequest;

  try {
    const data = await api.findingsControllerGetStats(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **sourceId** | `string` |  | [Optional] [Defaults to `undefined`] |

### Return type

`void` (Empty response body)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: Not defined


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Finding statistics |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## findingsControllerListAssetSummaries

> AssetFindingSummaryListResponseDto findingsControllerListAssetSummaries(detectorType, sourceId, assetId, runnerId, findingType, severity, status, includeResolved, detectionIdentity, firstDetectedAfter, lastDetectedBefore, skip, limit, sort)

List asset finding summaries with optional filters

### Example

```ts
import {
  Configuration,
  FindingsApi,
} from '@workspace/api-client';
import type { FindingsControllerListAssetSummariesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new FindingsApi();

  const body = {
    // 'SECRETS' | 'PII' | 'TOXIC' | 'NSFW' | 'YARA' | 'BROKEN_LINKS' | 'PROMPT_INJECTION' | 'PHISHING_URL' | 'SPAM' | 'LANGUAGE' | 'CODE_SECURITY' | 'PLAGIARISM' | 'IMAGE_VIOLENCE' | 'OCR_PII' | 'DEID_SCORE' | 'HATE_SPEECH' | 'AI_GENERATED' | 'CONTENT_QUALITY' | 'BIAS' | 'DUPLICATE' | 'DOMAIN_CLASS' | 'CONTENT_TYPE' | 'SENSITIVITY_TIER' | 'JURISDICTION_TAG' | 'CUSTOM' (optional)
    detectorType: detectorType_example,
    // string (optional)
    sourceId: sourceId_example,
    // string (optional)
    assetId: assetId_example,
    // string (optional)
    runnerId: runnerId_example,
    // string (optional)
    findingType: findingType_example,
    // 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO' (optional)
    severity: severity_example,
    // 'OPEN' | 'FALSE_POSITIVE' | 'RESOLVED' | 'IGNORED' (optional)
    status: status_example,
    // boolean (optional)
    includeResolved: true,
    // string (optional)
    detectionIdentity: detectionIdentity_example,
    // Date (optional)
    firstDetectedAfter: 2013-10-20T19:20:30+01:00,
    // Date (optional)
    lastDetectedBefore: 2013-10-20T19:20:30+01:00,
    // number (optional)
    skip: 8.14,
    // number (optional)
    limit: 8.14,
    // 'most_findings' | 'latest' | 'highest_severity' (optional)
    sort: sort_example,
  } satisfies FindingsControllerListAssetSummariesRequest;

  try {
    const data = await api.findingsControllerListAssetSummaries(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **detectorType** | `SECRETS`, `PII`, `TOXIC`, `NSFW`, `YARA`, `BROKEN_LINKS`, `PROMPT_INJECTION`, `PHISHING_URL`, `SPAM`, `LANGUAGE`, `CODE_SECURITY`, `PLAGIARISM`, `IMAGE_VIOLENCE`, `OCR_PII`, `DEID_SCORE`, `HATE_SPEECH`, `AI_GENERATED`, `CONTENT_QUALITY`, `BIAS`, `DUPLICATE`, `DOMAIN_CLASS`, `CONTENT_TYPE`, `SENSITIVITY_TIER`, `JURISDICTION_TAG`, `CUSTOM` |  | [Optional] [Defaults to `undefined`] [Enum: SECRETS, PII, TOXIC, NSFW, YARA, BROKEN_LINKS, PROMPT_INJECTION, PHISHING_URL, SPAM, LANGUAGE, CODE_SECURITY, PLAGIARISM, IMAGE_VIOLENCE, OCR_PII, DEID_SCORE, HATE_SPEECH, AI_GENERATED, CONTENT_QUALITY, BIAS, DUPLICATE, DOMAIN_CLASS, CONTENT_TYPE, SENSITIVITY_TIER, JURISDICTION_TAG, CUSTOM] |
| **sourceId** | `string` |  | [Optional] [Defaults to `undefined`] |
| **assetId** | `string` |  | [Optional] [Defaults to `undefined`] |
| **runnerId** | `string` |  | [Optional] [Defaults to `undefined`] |
| **findingType** | `string` |  | [Optional] [Defaults to `undefined`] |
| **severity** | `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFO` |  | [Optional] [Defaults to `undefined`] [Enum: CRITICAL, HIGH, MEDIUM, LOW, INFO] |
| **status** | `OPEN`, `FALSE_POSITIVE`, `RESOLVED`, `IGNORED` |  | [Optional] [Defaults to `undefined`] [Enum: OPEN, FALSE_POSITIVE, RESOLVED, IGNORED] |
| **includeResolved** | `boolean` |  | [Optional] [Defaults to `false`] |
| **detectionIdentity** | `string` |  | [Optional] [Defaults to `undefined`] |
| **firstDetectedAfter** | `Date` |  | [Optional] [Defaults to `undefined`] |
| **lastDetectedBefore** | `Date` |  | [Optional] [Defaults to `undefined`] |
| **skip** | `number` |  | [Optional] [Defaults to `0`] |
| **limit** | `number` |  | [Optional] [Defaults to `100`] |
| **sort** | `most_findings`, `latest`, `highest_severity` |  | [Optional] [Defaults to `&#39;most_findings&#39;`] [Enum: most_findings, latest, highest_severity] |

### Return type

[**AssetFindingSummaryListResponseDto**](AssetFindingSummaryListResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | List of asset finding summaries |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## findingsControllerUpdate

> FindingResponseDto findingsControllerUpdate(id, updateFindingDto)

Update a finding

### Example

```ts
import {
  Configuration,
  FindingsApi,
} from '@workspace/api-client';
import type { FindingsControllerUpdateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new FindingsApi();

  const body = {
    // string
    id: id_example,
    // UpdateFindingDto
    updateFindingDto: ...,
  } satisfies FindingsControllerUpdateRequest;

  try {
    const data = await api.findingsControllerUpdate(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **id** | `string` |  | [Defaults to `undefined`] |
| **updateFindingDto** | [UpdateFindingDto](UpdateFindingDto.md) |  | |

### Return type

[**FindingResponseDto**](FindingResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Finding updated successfully |  -  |
| **404** | Finding not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

