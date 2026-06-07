# GraphApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**graphControllerCreateManualEdge**](GraphApi.md#graphcontrollercreatemanualedge) | **POST** /graph/edges/manual | Create a manual edge between two entities (user-defined relation type) |
| [**graphControllerDeleteEdge**](GraphApi.md#graphcontrollerdeleteedge) | **DELETE** /graph/edges/{id} | Delete an edge |
| [**graphControllerExpand**](GraphApi.md#graphcontrollerexpand) | **POST** /graph/expand | Expand the graph around a seed entity (recursive traversal) |
| [**graphControllerIngestEdges**](GraphApi.md#graphcontrolleringestedges) | **POST** /graph/edges | Bulk-upsert source-derived edges from a connector. Idempotent. |
| [**graphControllerPivot**](GraphApi.md#graphcontrollerpivot) | **POST** /graph/pivot | Named pivot question on a node (e.g. who_touched, upstream_lineage, emails) |
| [**graphControllerRebuildEdges**](GraphApi.md#graphcontrollerrebuildedges) | **POST** /graph/rebuild-edges | Rebuild all inferred edges from existing assets and findings |
| [**graphControllerRelationTypes**](GraphApi.md#graphcontrollerrelationtypes) | **GET** /graph/relation-types | Get all relation types in use + vocabulary suggestions |
| [**graphControllerUpdateEdge**](GraphApi.md#graphcontrollerupdateedge) | **PATCH** /graph/edges/{id} | Rename an edge relation type |



## graphControllerCreateManualEdge

> EdgeDetailDto graphControllerCreateManualEdge(createManualEdgeDto)

Create a manual edge between two entities (user-defined relation type)

### Example

```ts
import {
  Configuration,
  GraphApi,
} from '@workspace/api-client';
import type { GraphControllerCreateManualEdgeRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GraphApi();

  const body = {
    // CreateManualEdgeDto
    createManualEdgeDto: ...,
  } satisfies GraphControllerCreateManualEdgeRequest;

  try {
    const data = await api.graphControllerCreateManualEdge(body);
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
| **createManualEdgeDto** | [CreateManualEdgeDto](CreateManualEdgeDto.md) |  | |

### Return type

[**EdgeDetailDto**](EdgeDetailDto.md)

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


## graphControllerDeleteEdge

> graphControllerDeleteEdge(id)

Delete an edge

### Example

```ts
import {
  Configuration,
  GraphApi,
} from '@workspace/api-client';
import type { GraphControllerDeleteEdgeRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GraphApi();

  const body = {
    // string
    id: id_example,
  } satisfies GraphControllerDeleteEdgeRequest;

  try {
    const data = await api.graphControllerDeleteEdge(body);
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
| **204** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## graphControllerExpand

> GraphResponseDto graphControllerExpand(expandGraphDto)

Expand the graph around a seed entity (recursive traversal)

### Example

```ts
import {
  Configuration,
  GraphApi,
} from '@workspace/api-client';
import type { GraphControllerExpandRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GraphApi();

  const body = {
    // ExpandGraphDto
    expandGraphDto: ...,
  } satisfies GraphControllerExpandRequest;

  try {
    const data = await api.graphControllerExpand(body);
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
| **expandGraphDto** | [ExpandGraphDto](ExpandGraphDto.md) |  | |

### Return type

[**GraphResponseDto**](GraphResponseDto.md)

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


## graphControllerIngestEdges

> BulkIngestEdgesResponseDto graphControllerIngestEdges(bulkIngestEdgesDto)

Bulk-upsert source-derived edges from a connector. Idempotent.

### Example

```ts
import {
  Configuration,
  GraphApi,
} from '@workspace/api-client';
import type { GraphControllerIngestEdgesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GraphApi();

  const body = {
    // BulkIngestEdgesDto
    bulkIngestEdgesDto: ...,
  } satisfies GraphControllerIngestEdgesRequest;

  try {
    const data = await api.graphControllerIngestEdges(body);
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
| **bulkIngestEdgesDto** | [BulkIngestEdgesDto](BulkIngestEdgesDto.md) |  | |

### Return type

[**BulkIngestEdgesResponseDto**](BulkIngestEdgesResponseDto.md)

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


## graphControllerPivot

> GraphResponseDto graphControllerPivot(pivotGraphDto)

Named pivot question on a node (e.g. who_touched, upstream_lineage, emails)

### Example

```ts
import {
  Configuration,
  GraphApi,
} from '@workspace/api-client';
import type { GraphControllerPivotRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GraphApi();

  const body = {
    // PivotGraphDto
    pivotGraphDto: ...,
  } satisfies GraphControllerPivotRequest;

  try {
    const data = await api.graphControllerPivot(body);
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
| **pivotGraphDto** | [PivotGraphDto](PivotGraphDto.md) |  | |

### Return type

[**GraphResponseDto**](GraphResponseDto.md)

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


## graphControllerRebuildEdges

> RebuildEdgesResponseDto graphControllerRebuildEdges()

Rebuild all inferred edges from existing assets and findings

### Example

```ts
import {
  Configuration,
  GraphApi,
} from '@workspace/api-client';
import type { GraphControllerRebuildEdgesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GraphApi();

  try {
    const data = await api.graphControllerRebuildEdges();
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

[**RebuildEdgesResponseDto**](RebuildEdgesResponseDto.md)

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


## graphControllerRelationTypes

> RelationTypesResponseDto graphControllerRelationTypes()

Get all relation types in use + vocabulary suggestions

### Example

```ts
import {
  Configuration,
  GraphApi,
} from '@workspace/api-client';
import type { GraphControllerRelationTypesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GraphApi();

  try {
    const data = await api.graphControllerRelationTypes();
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

[**RelationTypesResponseDto**](RelationTypesResponseDto.md)

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


## graphControllerUpdateEdge

> EdgeDetailDto graphControllerUpdateEdge(id, updateEdgeDto)

Rename an edge relation type

### Example

```ts
import {
  Configuration,
  GraphApi,
} from '@workspace/api-client';
import type { GraphControllerUpdateEdgeRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GraphApi();

  const body = {
    // string
    id: id_example,
    // UpdateEdgeDto
    updateEdgeDto: ...,
  } satisfies GraphControllerUpdateEdgeRequest;

  try {
    const data = await api.graphControllerUpdateEdge(body);
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
| **updateEdgeDto** | [UpdateEdgeDto](UpdateEdgeDto.md) |  | |

### Return type

[**EdgeDetailDto**](EdgeDetailDto.md)

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

