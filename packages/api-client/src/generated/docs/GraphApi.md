# GraphApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**graphControllerExpand**](GraphApi.md#graphcontrollerexpand) | **POST** /graph/expand | Expand the graph around a seed entity (recursive traversal) |
| [**graphControllerRebuildEdges**](GraphApi.md#graphcontrollerrebuildedges) | **POST** /graph/rebuild-edges | Rebuild all inferred edges from existing assets and findings |



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

