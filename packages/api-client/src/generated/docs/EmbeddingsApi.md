# EmbeddingsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**embeddingControllerChunks**](EmbeddingsApi.md#embeddingcontrollerchunks) | **POST** /sources/{sourceId}/embeddings/chunks | Store asset chunk-to-content mappings |
| [**embeddingControllerMissing**](EmbeddingsApi.md#embeddingcontrollermissing) | **POST** /sources/{sourceId}/embeddings/missing | Negotiate missing content-addressed embeddings |
| [**embeddingControllerSimilar**](EmbeddingsApi.md#embeddingcontrollersimilar) | **GET** /findings/{findingId}/similar | Find semantically similar findings with ranking evidence |
| [**embeddingControllerStatus**](EmbeddingsApi.md#embeddingcontrollerstatus) | **GET** /embeddings/status | Get semantic storage and search capability |
| [**embeddingControllerVectors**](EmbeddingsApi.md#embeddingcontrollervectors) | **POST** /sources/{sourceId}/embeddings/vectors | Store normalized embedding vectors |



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


## embeddingControllerMissing

> embeddingControllerMissing(sourceId, missingEmbeddingsDto)

Negotiate missing content-addressed embeddings

### Example

```ts
import {
  Configuration,
  EmbeddingsApi,
} from '@workspace/api-client';
import type { EmbeddingControllerMissingRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EmbeddingsApi();

  const body = {
    // string
    sourceId: sourceId_example,
    // MissingEmbeddingsDto
    missingEmbeddingsDto: ...,
  } satisfies EmbeddingControllerMissingRequest;

  try {
    const data = await api.embeddingControllerMissing(body);
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
| **missingEmbeddingsDto** | [MissingEmbeddingsDto](MissingEmbeddingsDto.md) |  | |

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


## embeddingControllerSimilar

> embeddingControllerSimilar(findingId, limit)

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

`void` (Empty response body)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: Not defined


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## embeddingControllerStatus

> embeddingControllerStatus()

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

`void` (Empty response body)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: Not defined


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## embeddingControllerVectors

> embeddingControllerVectors(sourceId, putEmbeddingVectorsDto)

Store normalized embedding vectors

### Example

```ts
import {
  Configuration,
  EmbeddingsApi,
} from '@workspace/api-client';
import type { EmbeddingControllerVectorsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EmbeddingsApi();

  const body = {
    // string
    sourceId: sourceId_example,
    // PutEmbeddingVectorsDto
    putEmbeddingVectorsDto: ...,
  } satisfies EmbeddingControllerVectorsRequest;

  try {
    const data = await api.embeddingControllerVectors(body);
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
| **putEmbeddingVectorsDto** | [PutEmbeddingVectorsDto](PutEmbeddingVectorsDto.md) |  | |

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

