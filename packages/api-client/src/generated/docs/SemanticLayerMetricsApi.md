# SemanticLayerMetricsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**metricsControllerCertify**](SemanticLayerMetricsApi.md#metricscontrollercertify) | **POST** /semantic/metrics/{id}/certify | Certify a metric (DRAFT → ACTIVE) |
| [**metricsControllerCreate**](SemanticLayerMetricsApi.md#metricscontrollercreate) | **POST** /semantic/metrics | Create a new metric definition |
| [**metricsControllerDelete**](SemanticLayerMetricsApi.md#metricscontrollerdelete) | **DELETE** /semantic/metrics/{id} | Delete a metric definition |
| [**metricsControllerFindAll**](SemanticLayerMetricsApi.md#metricscontrollerfindall) | **GET** /semantic/metrics | List all metric definitions |
| [**metricsControllerFindById**](SemanticLayerMetricsApi.md#metricscontrollerfindbyid) | **GET** /semantic/metrics/{id} | Get a metric definition by id |
| [**metricsControllerUpdate**](SemanticLayerMetricsApi.md#metricscontrollerupdate) | **PUT** /semantic/metrics/{id} | Update a metric definition |



## metricsControllerCertify

> metricsControllerCertify(id)

Certify a metric (DRAFT → ACTIVE)

### Example

```ts
import {
  Configuration,
  SemanticLayerMetricsApi,
} from '@workspace/api-client';
import type { MetricsControllerCertifyRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticLayerMetricsApi();

  const body = {
    // string
    id: id_example,
  } satisfies MetricsControllerCertifyRequest;

  try {
    const data = await api.metricsControllerCertify(body);
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

`void` (Empty response body)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: Not defined


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## metricsControllerCreate

> metricsControllerCreate(createMetricDefinitionDto)

Create a new metric definition

### Example

```ts
import {
  Configuration,
  SemanticLayerMetricsApi,
} from '@workspace/api-client';
import type { MetricsControllerCreateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticLayerMetricsApi();

  const body = {
    // CreateMetricDefinitionDto
    createMetricDefinitionDto: ...,
  } satisfies MetricsControllerCreateRequest;

  try {
    const data = await api.metricsControllerCreate(body);
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
| **createMetricDefinitionDto** | [CreateMetricDefinitionDto](CreateMetricDefinitionDto.md) |  | |

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


## metricsControllerDelete

> metricsControllerDelete(id)

Delete a metric definition

### Example

```ts
import {
  Configuration,
  SemanticLayerMetricsApi,
} from '@workspace/api-client';
import type { MetricsControllerDeleteRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticLayerMetricsApi();

  const body = {
    // string
    id: id_example,
  } satisfies MetricsControllerDeleteRequest;

  try {
    const data = await api.metricsControllerDelete(body);
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


## metricsControllerFindAll

> metricsControllerFindAll(type, status, isActive)

List all metric definitions

### Example

```ts
import {
  Configuration,
  SemanticLayerMetricsApi,
} from '@workspace/api-client';
import type { MetricsControllerFindAllRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticLayerMetricsApi();

  const body = {
    // string (optional)
    type: type_example,
    // string (optional)
    status: status_example,
    // boolean (optional)
    isActive: true,
  } satisfies MetricsControllerFindAllRequest;

  try {
    const data = await api.metricsControllerFindAll(body);
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
| **type** | `string` |  | [Optional] [Defaults to `undefined`] |
| **status** | `string` |  | [Optional] [Defaults to `undefined`] |
| **isActive** | `boolean` |  | [Optional] [Defaults to `undefined`] |

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


## metricsControllerFindById

> metricsControllerFindById(id)

Get a metric definition by id

### Example

```ts
import {
  Configuration,
  SemanticLayerMetricsApi,
} from '@workspace/api-client';
import type { MetricsControllerFindByIdRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticLayerMetricsApi();

  const body = {
    // string
    id: id_example,
  } satisfies MetricsControllerFindByIdRequest;

  try {
    const data = await api.metricsControllerFindById(body);
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


## metricsControllerUpdate

> metricsControllerUpdate(id, updateMetricDefinitionDto)

Update a metric definition

### Example

```ts
import {
  Configuration,
  SemanticLayerMetricsApi,
} from '@workspace/api-client';
import type { MetricsControllerUpdateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticLayerMetricsApi();

  const body = {
    // string
    id: id_example,
    // UpdateMetricDefinitionDto
    updateMetricDefinitionDto: ...,
  } satisfies MetricsControllerUpdateRequest;

  try {
    const data = await api.metricsControllerUpdate(body);
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
| **updateMetricDefinitionDto** | [UpdateMetricDefinitionDto](UpdateMetricDefinitionDto.md) |  | |

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
| **200** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

