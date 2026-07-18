# EmbeddingsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**embeddingControllerBoilerplate**](EmbeddingsApi.md#embeddingcontrollerboilerplate) | **GET** /sources/{sourceId}/boilerplate-clusters | Near-duplicate finding clusters in a source (repeated boilerplate) |
| [**embeddingControllerBoilerplateGlobal**](EmbeddingsApi.md#embeddingcontrollerboilerplateglobal) | **GET** /embeddings/boilerplate-clusters | Near-duplicate finding clusters across the corpus, optionally filtered to specific sources |
| [**embeddingControllerChunks**](EmbeddingsApi.md#embeddingcontrollerchunks) | **POST** /sources/{sourceId}/embeddings/chunks | Store asset chunk-to-content mappings |
| [**embeddingControllerRecalibrate**](EmbeddingsApi.md#embeddingcontrollerrecalibrate) | **POST** /embeddings/recalibrate | Schedule a full evidence-ranking recalibration pass (importance scores, outliers, near-duplicate groups) |
| [**embeddingControllerReindex**](EmbeddingsApi.md#embeddingcontrollerreindex) | **POST** /embeddings/reindex | Reconcile stored findings and asset chunks into the configured embedding space |
| [**embeddingControllerSimilar**](EmbeddingsApi.md#embeddingcontrollersimilar) | **GET** /findings/{findingId}/similar | Find semantically similar findings with ranking evidence |
| [**embeddingControllerStatus**](EmbeddingsApi.md#embeddingcontrollerstatus) | **GET** /embeddings/status | Get semantic storage and search capability |



## embeddingControllerBoilerplate

> Array&lt;BoilerplateClusterDto&gt; embeddingControllerBoilerplate(sourceId, threshold, limit)

Near-duplicate finding clusters in a source (repeated boilerplate)

### Example

```ts
import {
  Configuration,
  EmbeddingsApi,
} from '@workspace/api-client';
import type { EmbeddingControllerBoilerplateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EmbeddingsApi();

  const body = {
    // string
    sourceId: sourceId_example,
    // object (optional)
    threshold: ...,
    // object (optional)
    limit: ...,
  } satisfies EmbeddingControllerBoilerplateRequest;

  try {
    const data = await api.embeddingControllerBoilerplate(body);
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
| **threshold** | `object` |  | [Optional] [Defaults to `undefined`] |
| **limit** | `object` |  | [Optional] [Defaults to `undefined`] |

### Return type

[**Array&lt;BoilerplateClusterDto&gt;**](BoilerplateClusterDto.md)

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


## embeddingControllerBoilerplateGlobal

> Array&lt;BoilerplateClusterDto&gt; embeddingControllerBoilerplateGlobal(threshold, limit, sourceIds)

Near-duplicate finding clusters across the corpus, optionally filtered to specific sources

### Example

```ts
import {
  Configuration,
  EmbeddingsApi,
} from '@workspace/api-client';
import type { EmbeddingControllerBoilerplateGlobalRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EmbeddingsApi();

  const body = {
    // object (optional)
    threshold: ...,
    // object (optional)
    limit: ...,
    // Array<string> | Restrict clusters to findings from these sources; omit for the whole corpus (optional)
    sourceIds: ...,
  } satisfies EmbeddingControllerBoilerplateGlobalRequest;

  try {
    const data = await api.embeddingControllerBoilerplateGlobal(body);
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
| **threshold** | `object` |  | [Optional] [Defaults to `undefined`] |
| **limit** | `object` |  | [Optional] [Defaults to `undefined`] |
| **sourceIds** | `Array<string>` | Restrict clusters to findings from these sources; omit for the whole corpus | [Optional] |

### Return type

[**Array&lt;BoilerplateClusterDto&gt;**](BoilerplateClusterDto.md)

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


## embeddingControllerChunks

> embeddingControllerChunks(sourceId, putAssetChunksDto)

Store asset chunk-to-content mappings

### Example

```ts
import {
  Configuration,
  EmbeddingsApi,
} from '@workspace/api-client';
import type { EmbeddingControllerChunksRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EmbeddingsApi();

  const body = {
    // string
    sourceId: sourceId_example,
    // PutAssetChunksDto
    putAssetChunksDto: ...,
  } satisfies EmbeddingControllerChunksRequest;

  try {
    const data = await api.embeddingControllerChunks(body);
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
| **putAssetChunksDto** | [PutAssetChunksDto](PutAssetChunksDto.md) |  | |

### Return type

`void` (Empty response body)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: Not defined


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## embeddingControllerRecalibrate

> EmbeddingRecalibrateResponseDto embeddingControllerRecalibrate()

Schedule a full evidence-ranking recalibration pass (importance scores, outliers, near-duplicate groups)

### Example

```ts
import {
  Configuration,
  EmbeddingsApi,
} from '@workspace/api-client';
import type { EmbeddingControllerRecalibrateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EmbeddingsApi();

  try {
    const data = await api.embeddingControllerRecalibrate();
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

[**EmbeddingRecalibrateResponseDto**](EmbeddingRecalibrateResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **202** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## embeddingControllerReindex

> EmbeddingReindexResponseDto embeddingControllerReindex()

Reconcile stored findings and asset chunks into the configured embedding space

### Example

```ts
import {
  Configuration,
  EmbeddingsApi,
} from '@workspace/api-client';
import type { EmbeddingControllerReindexRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EmbeddingsApi();

  try {
    const data = await api.embeddingControllerReindex();
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

[**EmbeddingReindexResponseDto**](EmbeddingReindexResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **202** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## embeddingControllerSimilar

> Array&lt;SimilarFindingDto&gt; embeddingControllerSimilar(findingId, limit)

Find semantically similar findings with ranking evidence

### Example

```ts
import {
  Configuration,
  EmbeddingsApi,
} from '@workspace/api-client';
import type { EmbeddingControllerSimilarRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EmbeddingsApi();

  const body = {
    // string
    findingId: findingId_example,
    // object (optional)
    limit: ...,
  } satisfies EmbeddingControllerSimilarRequest;

  try {
    const data = await api.embeddingControllerSimilar(body);
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
| **findingId** | `string` |  | [Defaults to `undefined`] |
| **limit** | `object` |  | [Optional] [Defaults to `undefined`] |

### Return type

[**Array&lt;SimilarFindingDto&gt;**](SimilarFindingDto.md)

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


## embeddingControllerStatus

> EmbeddingStatusResponseDto embeddingControllerStatus()

Get semantic storage and search capability

### Example

```ts
import {
  Configuration,
  EmbeddingsApi,
} from '@workspace/api-client';
import type { EmbeddingControllerStatusRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EmbeddingsApi();

  try {
    const data = await api.embeddingControllerStatus();
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

[**EmbeddingStatusResponseDto**](EmbeddingStatusResponseDto.md)

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

