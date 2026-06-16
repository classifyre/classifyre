# CorrelationApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**correlationControllerAddExclusion**](CorrelationApi.md#correlationcontrolleraddexclusion) | **POST** /correlation/exclusions | Add an exclusion rule (ignore noisy values) and recompute |
| [**correlationControllerCaseAction**](CorrelationApi.md#correlationcontrollercaseaction) | **POST** /correlation/case-action | Create a case (or add to one) from assets selected in the fingerprints graph |
| [**correlationControllerGetConfig**](CorrelationApi.md#correlationcontrollergetconfig) | **GET** /correlation/config | Correlation tuning: per-label weights (dynamic) + match thresholds |
| [**correlationControllerGraph**](CorrelationApi.md#correlationcontrollergraph) | **GET** /correlation/graph | Correlation (\&quot;evidence fingerprints\&quot;) graph: assets linked through the findings they share |
| [**correlationControllerLinksGraph**](CorrelationApi.md#correlationcontrollerlinksgraph) | **GET** /correlation/links-graph | A source\&#39;s assets connected by their links (hash references) |
| [**correlationControllerOccurrences**](CorrelationApi.md#correlationcontrolleroccurrences) | **GET** /findings/occurrences | Where else a normalized finding value appears (reverse index) |
| [**correlationControllerRecompute**](CorrelationApi.md#correlationcontrollerrecompute) | **POST** /assets/{id}/recompute-correlation | Recompute correlation for a single asset (on demand) |
| [**correlationControllerRemoveExclusion**](CorrelationApi.md#correlationcontrollerremoveexclusion) | **DELETE** /correlation/exclusions/{id} | Remove an exclusion rule and recompute |
| [**correlationControllerUpdateConfig**](CorrelationApi.md#correlationcontrollerupdateconfig) | **PUT** /correlation/config | Update correlation tuning and schedule a full recompute (logged) |



## correlationControllerAddExclusion

> CorrelationConfigResponseDto correlationControllerAddExclusion(addExclusionDto)

Add an exclusion rule (ignore noisy values) and recompute

### Example

```ts
import {
  Configuration,
  CorrelationApi,
} from '@workspace/api-client';
import type { CorrelationControllerAddExclusionRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationApi();

  const body = {
    // AddExclusionDto
    addExclusionDto: ...,
  } satisfies CorrelationControllerAddExclusionRequest;

  try {
    const data = await api.correlationControllerAddExclusion(body);
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
| **addExclusionDto** | [AddExclusionDto](AddExclusionDto.md) |  | |

### Return type

[**CorrelationConfigResponseDto**](CorrelationConfigResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## correlationControllerCaseAction

> CaseActionResponseDto correlationControllerCaseAction(caseActionRequestDto)

Create a case (or add to one) from assets selected in the fingerprints graph

### Example

```ts
import {
  Configuration,
  CorrelationApi,
} from '@workspace/api-client';
import type { CorrelationControllerCaseActionRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationApi();

  const body = {
    // CaseActionRequestDto
    caseActionRequestDto: ...,
  } satisfies CorrelationControllerCaseActionRequest;

  try {
    const data = await api.correlationControllerCaseAction(body);
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
| **caseActionRequestDto** | [CaseActionRequestDto](CaseActionRequestDto.md) |  | |

### Return type

[**CaseActionResponseDto**](CaseActionResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## correlationControllerGetConfig

> CorrelationConfigResponseDto correlationControllerGetConfig()

Correlation tuning: per-label weights (dynamic) + match thresholds

### Example

```ts
import {
  Configuration,
  CorrelationApi,
} from '@workspace/api-client';
import type { CorrelationControllerGetConfigRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationApi();

  try {
    const data = await api.correlationControllerGetConfig();
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters

This endpoint does not need any parameter.

### Return type

[**CorrelationConfigResponseDto**](CorrelationConfigResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## correlationControllerGraph

> CorrelationGraphResponseDto correlationControllerGraph(assetId, sourceId)

Correlation (\&quot;evidence fingerprints\&quot;) graph: assets linked through the findings they share

### Example

```ts
import {
  Configuration,
  CorrelationApi,
} from '@workspace/api-client';
import type { CorrelationControllerGraphRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationApi();

  const body = {
    // string | Scope to one asset\'s identity cluster (optional)
    assetId: assetId_example,
    // string | Scope to clusters touching this source (external flagged) (optional)
    sourceId: sourceId_example,
  } satisfies CorrelationControllerGraphRequest;

  try {
    const data = await api.correlationControllerGraph(body);
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
| **assetId** | `string` | Scope to one asset\&#39;s identity cluster | [Optional] [Defaults to `undefined`] |
| **sourceId** | `string` | Scope to clusters touching this source (external flagged) | [Optional] [Defaults to `undefined`] |

### Return type

[**CorrelationGraphResponseDto**](CorrelationGraphResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## correlationControllerLinksGraph

> CorrelationGraphResponseDto correlationControllerLinksGraph(sourceId)

A source\&#39;s assets connected by their links (hash references)

### Example

```ts
import {
  Configuration,
  CorrelationApi,
} from '@workspace/api-client';
import type { CorrelationControllerLinksGraphRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationApi();

  const body = {
    // string
    sourceId: sourceId_example,
  } satisfies CorrelationControllerLinksGraphRequest;

  try {
    const data = await api.correlationControllerLinksGraph(body);
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
| **sourceId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**CorrelationGraphResponseDto**](CorrelationGraphResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## correlationControllerOccurrences

> ValueOccurrencesResponseDto correlationControllerOccurrences(label, value, valueHash)

Where else a normalized finding value appears (reverse index)

### Example

```ts
import {
  Configuration,
  CorrelationApi,
} from '@workspace/api-client';
import type { CorrelationControllerOccurrencesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationApi();

  const body = {
    // string (optional)
    label: label_example,
    // string (optional)
    value: value_example,
    // string (optional)
    valueHash: valueHash_example,
  } satisfies CorrelationControllerOccurrencesRequest;

  try {
    const data = await api.correlationControllerOccurrences(body);
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
| **label** | `string` |  | [Optional] [Defaults to `undefined`] |
| **value** | `string` |  | [Optional] [Defaults to `undefined`] |
| **valueHash** | `string` |  | [Optional] [Defaults to `undefined`] |

### Return type

[**ValueOccurrencesResponseDto**](ValueOccurrencesResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## correlationControllerRecompute

> RecomputeCorrelationResponseDto correlationControllerRecompute(id)

Recompute correlation for a single asset (on demand)

### Example

```ts
import {
  Configuration,
  CorrelationApi,
} from '@workspace/api-client';
import type { CorrelationControllerRecomputeRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationApi();

  const body = {
    // string
    id: id_example,
  } satisfies CorrelationControllerRecomputeRequest;

  try {
    const data = await api.correlationControllerRecompute(body);
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

[**RecomputeCorrelationResponseDto**](RecomputeCorrelationResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## correlationControllerRemoveExclusion

> CorrelationConfigResponseDto correlationControllerRemoveExclusion(id)

Remove an exclusion rule and recompute

### Example

```ts
import {
  Configuration,
  CorrelationApi,
} from '@workspace/api-client';
import type { CorrelationControllerRemoveExclusionRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationApi();

  const body = {
    // string
    id: id_example,
  } satisfies CorrelationControllerRemoveExclusionRequest;

  try {
    const data = await api.correlationControllerRemoveExclusion(body);
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

[**CorrelationConfigResponseDto**](CorrelationConfigResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## correlationControllerUpdateConfig

> CorrelationConfigResponseDto correlationControllerUpdateConfig(updateCorrelationConfigDto)

Update correlation tuning and schedule a full recompute (logged)

### Example

```ts
import {
  Configuration,
  CorrelationApi,
} from '@workspace/api-client';
import type { CorrelationControllerUpdateConfigRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationApi();

  const body = {
    // UpdateCorrelationConfigDto
    updateCorrelationConfigDto: ...,
  } satisfies CorrelationControllerUpdateConfigRequest;

  try {
    const data = await api.correlationControllerUpdateConfig(body);
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
| **updateCorrelationConfigDto** | [UpdateCorrelationConfigDto](UpdateCorrelationConfigDto.md) |  | |

### Return type

[**CorrelationConfigResponseDto**](CorrelationConfigResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

