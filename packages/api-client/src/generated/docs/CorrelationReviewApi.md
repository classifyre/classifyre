# CorrelationReviewApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**correlationReviewControllerApply**](CorrelationReviewApi.md#correlationreviewcontrollerapply) | **POST** /correlation/review/patterns/{patternKey}/apply | Decide a whole pattern at once, reversibly via the undo log |
| [**correlationReviewControllerCause**](CorrelationReviewApi.md#correlationreviewcontrollercause) | **GET** /correlation/review/pairs/{aId}/{bId}/cause | What drove this match, framed as something to fix |
| [**correlationReviewControllerClusters**](CorrelationReviewApi.md#correlationreviewcontrollerclusters) | **GET** /correlation/review/patterns/{patternKey}/clusters | Level 2: clusters inside one pattern |
| [**correlationReviewControllerDecisions**](CorrelationReviewApi.md#correlationreviewcontrollerdecisions) | **GET** /correlation/review/decisions | What has been decided, and what became of it |
| [**correlationReviewControllerDecisionsToCase**](CorrelationReviewApi.md#correlationreviewcontrollerdecisionstocase) | **POST** /correlation/review/decisions/case | Take decided pairs into a case as evidence |
| [**correlationReviewControllerDecisionsToInquiry**](CorrelationReviewApi.md#correlationreviewcontrollerdecisionstoinquiry) | **POST** /correlation/review/decisions/inquiry | Open an inquiry that keeps watching for what these pairs had in common |
| [**correlationReviewControllerExclusionCandidates**](CorrelationReviewApi.md#correlationreviewcontrollerexclusioncandidates) | **GET** /correlation/review/patterns/{patternKey}/exclusion-candidates | The values inside a near-duplicate text group, and their reach |
| [**correlationReviewControllerPair**](CorrelationReviewApi.md#correlationreviewcontrollerpair) | **GET** /correlation/review/pairs/{aId}/{bId} | Level 3: one pair — comparison, match-weight decomposition, local graph, lineage evidence |
| [**correlationReviewControllerPortfolio**](CorrelationReviewApi.md#correlationreviewcontrollerportfolio) | **GET** /correlation/review/portfolio | Level 1: work remaining, the pattern queue, and the source meta-graph |
| [**correlationReviewControllerPreview**](CorrelationReviewApi.md#correlationreviewcontrollerpreview) | **POST** /correlation/review/patterns/{patternKey}/preview | What a bulk action would do. Read-only — nothing is applied. |
| [**correlationReviewControllerRebuild**](CorrelationReviewApi.md#correlationreviewcontrollerrebuild) | **POST** /correlation/review/rebuild | Rebuild the review rollups from existing correlation data |
| [**correlationReviewControllerRecordVerdicts**](CorrelationReviewApi.md#correlationreviewcontrollerrecordverdicts) | **POST** /correlation/review/verdicts | Record a decision on one or more pairs |
| [**correlationReviewControllerReopen**](CorrelationReviewApi.md#correlationreviewcontrollerreopen) | **POST** /correlation/review/decisions/reopen | Put decided pairs back in the queue |
| [**correlationReviewControllerSample**](CorrelationReviewApi.md#correlationreviewcontrollersample) | **GET** /correlation/review/patterns/{patternKey}/sample | The next undecided pairs in a pattern, strongest first |
| [**correlationReviewControllerSplit**](CorrelationReviewApi.md#correlationreviewcontrollersplit) | **POST** /correlation/review/pairs/{aId}/{bId}/split | Cut the link between two assets. The verdict keeps later scans from rejoining them. |
| [**correlationReviewControllerUndo**](CorrelationReviewApi.md#correlationreviewcontrollerundo) | **POST** /correlation/review/verdicts/undo | Revert one batch of decisions |
| [**correlationReviewControllerUndoLog**](CorrelationReviewApi.md#correlationreviewcontrollerundolog) | **GET** /correlation/review/undo-log | Recent bulk actions, newest first |



## correlationReviewControllerApply

> PatternApplyResponseDto correlationReviewControllerApply(patternKey, patternActionDto)

Decide a whole pattern at once, reversibly via the undo log

### Example

```ts
import {
  Configuration,
  CorrelationReviewApi,
} from '@workspace/api-client';
import type { CorrelationReviewControllerApplyRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationReviewApi();

  const body = {
    // string
    patternKey: patternKey_example,
    // PatternActionDto
    patternActionDto: ...,
  } satisfies CorrelationReviewControllerApplyRequest;

  try {
    const data = await api.correlationReviewControllerApply(body);
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
| **patternKey** | `string` |  | [Defaults to `undefined`] |
| **patternActionDto** | [PatternActionDto](PatternActionDto.md) |  | |

### Return type

[**PatternApplyResponseDto**](PatternApplyResponseDto.md)

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


## correlationReviewControllerCause

> RejectCauseDto correlationReviewControllerCause(aId, bId)

What drove this match, framed as something to fix

Rejecting a pair without addressing the cause means the next scan produces it again. This names the label carrying the score and how many other pairs the same combination produced.

### Example

```ts
import {
  Configuration,
  CorrelationReviewApi,
} from '@workspace/api-client';
import type { CorrelationReviewControllerCauseRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationReviewApi();

  const body = {
    // string
    aId: aId_example,
    // string
    bId: bId_example,
  } satisfies CorrelationReviewControllerCauseRequest;

  try {
    const data = await api.correlationReviewControllerCause(body);
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
| **aId** | `string` |  | [Defaults to `undefined`] |
| **bId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**RejectCauseDto**](RejectCauseDto.md)

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


## correlationReviewControllerClusters

> ReviewClustersResponseDto correlationReviewControllerClusters(patternKey, min, max, lineage, cursor, limit, sourceIds)

Level 2: clusters inside one pattern

### Example

```ts
import {
  Configuration,
  CorrelationReviewApi,
} from '@workspace/api-client';
import type { CorrelationReviewControllerClustersRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationReviewApi();

  const body = {
    // string
    patternKey: patternKey_example,
    // string (optional)
    min: min_example,
    // string (optional)
    max: max_example,
    // 'PATH' | 'NO_PATH' | 'UNKNOWN' (optional)
    lineage: lineage_example,
    // string (optional)
    cursor: cursor_example,
    // string (optional)
    limit: limit_example,
    // string (optional)
    sourceIds: sourceIds_example,
  } satisfies CorrelationReviewControllerClustersRequest;

  try {
    const data = await api.correlationReviewControllerClusters(body);
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
| **patternKey** | `string` |  | [Defaults to `undefined`] |
| **min** | `string` |  | [Optional] [Defaults to `undefined`] |
| **max** | `string` |  | [Optional] [Defaults to `undefined`] |
| **lineage** | `PATH`, `NO_PATH`, `UNKNOWN` |  | [Optional] [Defaults to `undefined`] [Enum: PATH, NO_PATH, UNKNOWN] |
| **cursor** | `string` |  | [Optional] [Defaults to `undefined`] |
| **limit** | `string` |  | [Optional] [Defaults to `undefined`] |
| **sourceIds** | `string` |  | [Optional] [Defaults to `undefined`] |

### Return type

[**ReviewClustersResponseDto**](ReviewClustersResponseDto.md)

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


## correlationReviewControllerDecisions

> ReviewDecisionsResponseDto correlationReviewControllerDecisions(verdict, patternKey, unactionedOnly, cursor, limit)

What has been decided, and what became of it

The other half of the queue. A decision that cannot be found again is a keystroke, not a judgement — this lists what was decided, whether a person or an agent decided it, and whether it was ever taken into a case or an inquiry. Filter to the ones that went nowhere with unactionedOnly.

### Example

```ts
import {
  Configuration,
  CorrelationReviewApi,
} from '@workspace/api-client';
import type { CorrelationReviewControllerDecisionsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationReviewApi();

  const body = {
    // string (optional)
    verdict: verdict_example,
    // string (optional)
    patternKey: patternKey_example,
    // string (optional)
    unactionedOnly: unactionedOnly_example,
    // string (optional)
    cursor: cursor_example,
    // string (optional)
    limit: limit_example,
  } satisfies CorrelationReviewControllerDecisionsRequest;

  try {
    const data = await api.correlationReviewControllerDecisions(body);
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
| **verdict** | `string` |  | [Optional] [Defaults to `undefined`] |
| **patternKey** | `string` |  | [Optional] [Defaults to `undefined`] |
| **unactionedOnly** | `string` |  | [Optional] [Defaults to `undefined`] |
| **cursor** | `string` |  | [Optional] [Defaults to `undefined`] |
| **limit** | `string` |  | [Optional] [Defaults to `undefined`] |

### Return type

[**ReviewDecisionsResponseDto**](ReviewDecisionsResponseDto.md)

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


## correlationReviewControllerDecisionsToCase

> DecisionsToCaseResponseDto correlationReviewControllerDecisionsToCase(decisionsToCaseDto)

Take decided pairs into a case as evidence

### Example

```ts
import {
  Configuration,
  CorrelationReviewApi,
} from '@workspace/api-client';
import type { CorrelationReviewControllerDecisionsToCaseRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationReviewApi();

  const body = {
    // DecisionsToCaseDto
    decisionsToCaseDto: ...,
  } satisfies CorrelationReviewControllerDecisionsToCaseRequest;

  try {
    const data = await api.correlationReviewControllerDecisionsToCase(body);
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
| **decisionsToCaseDto** | [DecisionsToCaseDto](DecisionsToCaseDto.md) |  | |

### Return type

[**DecisionsToCaseResponseDto**](DecisionsToCaseResponseDto.md)

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


## correlationReviewControllerDecisionsToInquiry

> DecisionsToInquiryResponseDto correlationReviewControllerDecisionsToInquiry(decisionsToInquiryDto)

Open an inquiry that keeps watching for what these pairs had in common

### Example

```ts
import {
  Configuration,
  CorrelationReviewApi,
} from '@workspace/api-client';
import type { CorrelationReviewControllerDecisionsToInquiryRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationReviewApi();

  const body = {
    // DecisionsToInquiryDto
    decisionsToInquiryDto: ...,
  } satisfies CorrelationReviewControllerDecisionsToInquiryRequest;

  try {
    const data = await api.correlationReviewControllerDecisionsToInquiry(body);
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
| **decisionsToInquiryDto** | [DecisionsToInquiryDto](DecisionsToInquiryDto.md) |  | |

### Return type

[**DecisionsToInquiryResponseDto**](DecisionsToInquiryResponseDto.md)

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


## correlationReviewControllerExclusionCandidates

> PatternExclusionCandidatesResponseDto correlationReviewControllerExclusionCandidates(patternKey)

The values inside a near-duplicate text group, and their reach

What an exclusion on this pattern would actually stop matching. Empty for any pattern whose rule kind is not EXCLUSION — the other kinds have no template to read values out of. Read-only.

### Example

```ts
import {
  Configuration,
  CorrelationReviewApi,
} from '@workspace/api-client';
import type { CorrelationReviewControllerExclusionCandidatesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationReviewApi();

  const body = {
    // string
    patternKey: patternKey_example,
  } satisfies CorrelationReviewControllerExclusionCandidatesRequest;

  try {
    const data = await api.correlationReviewControllerExclusionCandidates(body);
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
| **patternKey** | `string` |  | [Defaults to `undefined`] |

### Return type

[**PatternExclusionCandidatesResponseDto**](PatternExclusionCandidatesResponseDto.md)

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


## correlationReviewControllerPair

> ReviewPairResponseDto correlationReviewControllerPair(aId, bId)

Level 3: one pair — comparison, match-weight decomposition, local graph, lineage evidence

### Example

```ts
import {
  Configuration,
  CorrelationReviewApi,
} from '@workspace/api-client';
import type { CorrelationReviewControllerPairRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationReviewApi();

  const body = {
    // string
    aId: aId_example,
    // string
    bId: bId_example,
  } satisfies CorrelationReviewControllerPairRequest;

  try {
    const data = await api.correlationReviewControllerPair(body);
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
| **aId** | `string` |  | [Defaults to `undefined`] |
| **bId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**ReviewPairResponseDto**](ReviewPairResponseDto.md)

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


## correlationReviewControllerPortfolio

> ReviewPortfolioResponseDto correlationReviewControllerPortfolio(sourceIds)

Level 1: work remaining, the pattern queue, and the source meta-graph

Includes a 20-bin score histogram per pattern so the client can recompute every count on the page as a cutoff moves, without another request.

### Example

```ts
import {
  Configuration,
  CorrelationReviewApi,
} from '@workspace/api-client';
import type { CorrelationReviewControllerPortfolioRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationReviewApi();

  const body = {
    // string | Narrow to pairs touching any of these sources (comma separated). Either side counts — restricting to both would hide the cross-system pairs. (optional)
    sourceIds: sourceIds_example,
  } satisfies CorrelationReviewControllerPortfolioRequest;

  try {
    const data = await api.correlationReviewControllerPortfolio(body);
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
| **sourceIds** | `string` | Narrow to pairs touching any of these sources (comma separated). Either side counts — restricting to both would hide the cross-system pairs. | [Optional] [Defaults to `undefined`] |

### Return type

[**ReviewPortfolioResponseDto**](ReviewPortfolioResponseDto.md)

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


## correlationReviewControllerPreview

> PatternPreviewResponseDto correlationReviewControllerPreview(patternKey, patternActionDto)

What a bulk action would do. Read-only — nothing is applied.

### Example

```ts
import {
  Configuration,
  CorrelationReviewApi,
} from '@workspace/api-client';
import type { CorrelationReviewControllerPreviewRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationReviewApi();

  const body = {
    // string
    patternKey: patternKey_example,
    // PatternActionDto
    patternActionDto: ...,
  } satisfies CorrelationReviewControllerPreviewRequest;

  try {
    const data = await api.correlationReviewControllerPreview(body);
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
| **patternKey** | `string` |  | [Defaults to `undefined`] |
| **patternActionDto** | [PatternActionDto](PatternActionDto.md) |  | |

### Return type

[**PatternPreviewResponseDto**](PatternPreviewResponseDto.md)

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


## correlationReviewControllerRebuild

> RebuildIndexResponseDto correlationReviewControllerRebuild()

Rebuild the review rollups from existing correlation data

Derived from edges, clusters and correlation values that are already stored — this does not re-scan or re-fingerprint anything. Use it when a namespace was scanned before the review queue existed and its queue reads empty.

### Example

```ts
import {
  Configuration,
  CorrelationReviewApi,
} from '@workspace/api-client';
import type { CorrelationReviewControllerRebuildRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationReviewApi();

  try {
    const data = await api.correlationReviewControllerRebuild();
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

[**RebuildIndexResponseDto**](RebuildIndexResponseDto.md)

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


## correlationReviewControllerRecordVerdicts

> RecordVerdictResponseDto correlationReviewControllerRecordVerdicts(recordVerdictDto)

Record a decision on one or more pairs

### Example

```ts
import {
  Configuration,
  CorrelationReviewApi,
} from '@workspace/api-client';
import type { CorrelationReviewControllerRecordVerdictsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationReviewApi();

  const body = {
    // RecordVerdictDto
    recordVerdictDto: ...,
  } satisfies CorrelationReviewControllerRecordVerdictsRequest;

  try {
    const data = await api.correlationReviewControllerRecordVerdicts(body);
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
| **recordVerdictDto** | [RecordVerdictDto](RecordVerdictDto.md) |  | |

### Return type

[**RecordVerdictResponseDto**](RecordVerdictResponseDto.md)

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


## correlationReviewControllerReopen

> ReopenDecisionsResponseDto correlationReviewControllerReopen(reopenDecisionsDto)

Put decided pairs back in the queue

Removes the verdict, and re-clusters the neighbourhood when the verdict was one that had been suppressing it.

### Example

```ts
import {
  Configuration,
  CorrelationReviewApi,
} from '@workspace/api-client';
import type { CorrelationReviewControllerReopenRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationReviewApi();

  const body = {
    // ReopenDecisionsDto
    reopenDecisionsDto: ...,
  } satisfies CorrelationReviewControllerReopenRequest;

  try {
    const data = await api.correlationReviewControllerReopen(body);
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
| **reopenDecisionsDto** | [ReopenDecisionsDto](ReopenDecisionsDto.md) |  | |

### Return type

[**ReopenDecisionsResponseDto**](ReopenDecisionsResponseDto.md)

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


## correlationReviewControllerSample

> ReviewSampleResponseDto correlationReviewControllerSample(patternKey, n, min, max, lineage, sourceIds)

The next undecided pairs in a pattern, strongest first

### Example

```ts
import {
  Configuration,
  CorrelationReviewApi,
} from '@workspace/api-client';
import type { CorrelationReviewControllerSampleRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationReviewApi();

  const body = {
    // string
    patternKey: patternKey_example,
    // string (optional)
    n: n_example,
    // string (optional)
    min: min_example,
    // string (optional)
    max: max_example,
    // string (optional)
    lineage: lineage_example,
    // string (optional)
    sourceIds: sourceIds_example,
  } satisfies CorrelationReviewControllerSampleRequest;

  try {
    const data = await api.correlationReviewControllerSample(body);
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
| **patternKey** | `string` |  | [Defaults to `undefined`] |
| **n** | `string` |  | [Optional] [Defaults to `undefined`] |
| **min** | `string` |  | [Optional] [Defaults to `undefined`] |
| **max** | `string` |  | [Optional] [Defaults to `undefined`] |
| **lineage** | `string` |  | [Optional] [Defaults to `undefined`] |
| **sourceIds** | `string` |  | [Optional] [Defaults to `undefined`] |

### Return type

[**ReviewSampleResponseDto**](ReviewSampleResponseDto.md)

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


## correlationReviewControllerSplit

> SplitPairResponseDto correlationReviewControllerSplit(aId, bId)

Cut the link between two assets. The verdict keeps later scans from rejoining them.

### Example

```ts
import {
  Configuration,
  CorrelationReviewApi,
} from '@workspace/api-client';
import type { CorrelationReviewControllerSplitRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationReviewApi();

  const body = {
    // string
    aId: aId_example,
    // string
    bId: bId_example,
  } satisfies CorrelationReviewControllerSplitRequest;

  try {
    const data = await api.correlationReviewControllerSplit(body);
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
| **aId** | `string` |  | [Defaults to `undefined`] |
| **bId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**SplitPairResponseDto**](SplitPairResponseDto.md)

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


## correlationReviewControllerUndo

> UndoBatchResponseDto correlationReviewControllerUndo(undoBatchDto)

Revert one batch of decisions

### Example

```ts
import {
  Configuration,
  CorrelationReviewApi,
} from '@workspace/api-client';
import type { CorrelationReviewControllerUndoRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationReviewApi();

  const body = {
    // UndoBatchDto
    undoBatchDto: ...,
  } satisfies CorrelationReviewControllerUndoRequest;

  try {
    const data = await api.correlationReviewControllerUndo(body);
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
| **undoBatchDto** | [UndoBatchDto](UndoBatchDto.md) |  | |

### Return type

[**UndoBatchResponseDto**](UndoBatchResponseDto.md)

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


## correlationReviewControllerUndoLog

> UndoLogResponseDto correlationReviewControllerUndoLog(limit)

Recent bulk actions, newest first

### Example

```ts
import {
  Configuration,
  CorrelationReviewApi,
} from '@workspace/api-client';
import type { CorrelationReviewControllerUndoLogRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CorrelationReviewApi();

  const body = {
    // string (optional)
    limit: limit_example,
  } satisfies CorrelationReviewControllerUndoLogRequest;

  try {
    const data = await api.correlationReviewControllerUndoLog(body);
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
| **limit** | `string` |  | [Optional] [Defaults to `undefined`] |

### Return type

[**UndoLogResponseDto**](UndoLogResponseDto.md)

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

