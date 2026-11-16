# SharedDatasetsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**sharedDatasetsControllerBlock**](SharedDatasetsApi.md#shareddatasetscontrollerblock) | **POST** /shared-datasets/{id}/blocks | Block it from reading your table (or source): nobody reads it until lifted |
| [**sharedDatasetsControllerCreate**](SharedDatasetsApi.md#shareddatasetscontrollercreate) | **POST** /shared-datasets | Share a query as a dataset |
| [**sharedDatasetsControllerDescribe**](SharedDatasetsApi.md#shareddatasetscontrollerdescribe) | **POST** /shared-datasets/describe | What a query would be as a shared dataset: columns, inherited classification, inputs, whether you may share it |
| [**sharedDatasetsControllerGet**](SharedDatasetsApi.md#shareddatasetscontrollerget) | **GET** /shared-datasets/{id} | One shared dataset (its asset id) |
| [**sharedDatasetsControllerList**](SharedDatasetsApi.md#shareddatasetscontrollerlist) | **GET** /shared-datasets | Every shared dataset of the workspace |
| [**sharedDatasetsControllerOptions**](SharedDatasetsApi.md#shareddatasetscontrolleroptions) | **GET** /shared-datasets/options | Whether you may share datasets here, and your groups |
| [**sharedDatasetsControllerPromote**](SharedDatasetsApi.md#shareddatasetscontrollerpromote) | **POST** /shared-datasets/{id}/promote | Mark it promoted (ready), or take that back |
| [**sharedDatasetsControllerUnblock**](SharedDatasetsApi.md#shareddatasetscontrollerunblock) | **DELETE** /shared-datasets/{id}/blocks/{blockId} | Lift a block |
| [**sharedDatasetsControllerUpdate**](SharedDatasetsApi.md#shareddatasetscontrollerupdate) | **PATCH** /shared-datasets/{id} | Change the SQL, description or owning group (a new version) |
| [**sharedDatasetsControllerUses**](SharedDatasetsApi.md#shareddatasetscontrolleruses) | **GET** /shared-datasets/uses | Shared datasets that read a table or any table of a source |
| [**sharedDatasetsControllerVersions**](SharedDatasetsApi.md#shareddatasetscontrollerversions) | **GET** /shared-datasets/{id}/versions | Every saved version of its definition |



## sharedDatasetsControllerBlock

> Array&lt;SharedDatasetUseDto&gt; sharedDatasetsControllerBlock(id, blockSharedDatasetDto)

Block it from reading your table (or source): nobody reads it until lifted

### Example

```ts
import {
  Configuration,
  SharedDatasetsApi,
} from '@workspace/api-client';
import type { SharedDatasetsControllerBlockRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SharedDatasetsApi();

  const body = {
    // string
    id: id_example,
    // BlockSharedDatasetDto
    blockSharedDatasetDto: ...,
  } satisfies SharedDatasetsControllerBlockRequest;

  try {
    const data = await api.sharedDatasetsControllerBlock(body);
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
| **blockSharedDatasetDto** | [BlockSharedDatasetDto](BlockSharedDatasetDto.md) |  | |

### Return type

[**Array&lt;SharedDatasetUseDto&gt;**](SharedDatasetUseDto.md)

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


## sharedDatasetsControllerCreate

> SharedDatasetDto sharedDatasetsControllerCreate(createSharedDatasetDto)

Share a query as a dataset

### Example

```ts
import {
  Configuration,
  SharedDatasetsApi,
} from '@workspace/api-client';
import type { SharedDatasetsControllerCreateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SharedDatasetsApi();

  const body = {
    // CreateSharedDatasetDto
    createSharedDatasetDto: ...,
  } satisfies SharedDatasetsControllerCreateRequest;

  try {
    const data = await api.sharedDatasetsControllerCreate(body);
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
| **createSharedDatasetDto** | [CreateSharedDatasetDto](CreateSharedDatasetDto.md) |  | |

### Return type

[**SharedDatasetDto**](SharedDatasetDto.md)

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


## sharedDatasetsControllerDescribe

> SharedDatasetDescriptionDto sharedDatasetsControllerDescribe(describeSharedDatasetDto)

What a query would be as a shared dataset: columns, inherited classification, inputs, whether you may share it

### Example

```ts
import {
  Configuration,
  SharedDatasetsApi,
} from '@workspace/api-client';
import type { SharedDatasetsControllerDescribeRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SharedDatasetsApi();

  const body = {
    // DescribeSharedDatasetDto
    describeSharedDatasetDto: ...,
  } satisfies SharedDatasetsControllerDescribeRequest;

  try {
    const data = await api.sharedDatasetsControllerDescribe(body);
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
| **describeSharedDatasetDto** | [DescribeSharedDatasetDto](DescribeSharedDatasetDto.md) |  | |

### Return type

[**SharedDatasetDescriptionDto**](SharedDatasetDescriptionDto.md)

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


## sharedDatasetsControllerGet

> SharedDatasetDto sharedDatasetsControllerGet(id)

One shared dataset (its asset id)

### Example

```ts
import {
  Configuration,
  SharedDatasetsApi,
} from '@workspace/api-client';
import type { SharedDatasetsControllerGetRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SharedDatasetsApi();

  const body = {
    // string
    id: id_example,
  } satisfies SharedDatasetsControllerGetRequest;

  try {
    const data = await api.sharedDatasetsControllerGet(body);
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

[**SharedDatasetDto**](SharedDatasetDto.md)

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


## sharedDatasetsControllerList

> Array&lt;SharedDatasetSummaryDto&gt; sharedDatasetsControllerList()

Every shared dataset of the workspace

### Example

```ts
import {
  Configuration,
  SharedDatasetsApi,
} from '@workspace/api-client';
import type { SharedDatasetsControllerListRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SharedDatasetsApi();

  try {
    const data = await api.sharedDatasetsControllerList();
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

[**Array&lt;SharedDatasetSummaryDto&gt;**](SharedDatasetSummaryDto.md)

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


## sharedDatasetsControllerOptions

> SharedDatasetOptionsDto sharedDatasetsControllerOptions()

Whether you may share datasets here, and your groups

### Example

```ts
import {
  Configuration,
  SharedDatasetsApi,
} from '@workspace/api-client';
import type { SharedDatasetsControllerOptionsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SharedDatasetsApi();

  try {
    const data = await api.sharedDatasetsControllerOptions();
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

[**SharedDatasetOptionsDto**](SharedDatasetOptionsDto.md)

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


## sharedDatasetsControllerPromote

> SharedDatasetDto sharedDatasetsControllerPromote(id, promoteSharedDatasetDto)

Mark it promoted (ready), or take that back

### Example

```ts
import {
  Configuration,
  SharedDatasetsApi,
} from '@workspace/api-client';
import type { SharedDatasetsControllerPromoteRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SharedDatasetsApi();

  const body = {
    // string
    id: id_example,
    // PromoteSharedDatasetDto
    promoteSharedDatasetDto: ...,
  } satisfies SharedDatasetsControllerPromoteRequest;

  try {
    const data = await api.sharedDatasetsControllerPromote(body);
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
| **promoteSharedDatasetDto** | [PromoteSharedDatasetDto](PromoteSharedDatasetDto.md) |  | |

### Return type

[**SharedDatasetDto**](SharedDatasetDto.md)

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


## sharedDatasetsControllerUnblock

> Array&lt;SharedDatasetUseDto&gt; sharedDatasetsControllerUnblock(id, blockId)

Lift a block

### Example

```ts
import {
  Configuration,
  SharedDatasetsApi,
} from '@workspace/api-client';
import type { SharedDatasetsControllerUnblockRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SharedDatasetsApi();

  const body = {
    // string
    id: id_example,
    // string
    blockId: blockId_example,
  } satisfies SharedDatasetsControllerUnblockRequest;

  try {
    const data = await api.sharedDatasetsControllerUnblock(body);
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
| **blockId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**Array&lt;SharedDatasetUseDto&gt;**](SharedDatasetUseDto.md)

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


## sharedDatasetsControllerUpdate

> SharedDatasetDto sharedDatasetsControllerUpdate(id, updateSharedDatasetDto)

Change the SQL, description or owning group (a new version)

### Example

```ts
import {
  Configuration,
  SharedDatasetsApi,
} from '@workspace/api-client';
import type { SharedDatasetsControllerUpdateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SharedDatasetsApi();

  const body = {
    // string
    id: id_example,
    // UpdateSharedDatasetDto
    updateSharedDatasetDto: ...,
  } satisfies SharedDatasetsControllerUpdateRequest;

  try {
    const data = await api.sharedDatasetsControllerUpdate(body);
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
| **updateSharedDatasetDto** | [UpdateSharedDatasetDto](UpdateSharedDatasetDto.md) |  | |

### Return type

[**SharedDatasetDto**](SharedDatasetDto.md)

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


## sharedDatasetsControllerUses

> Array&lt;SharedDatasetUseDto&gt; sharedDatasetsControllerUses(scopeType, scopeId)

Shared datasets that read a table or any table of a source

### Example

```ts
import {
  Configuration,
  SharedDatasetsApi,
} from '@workspace/api-client';
import type { SharedDatasetsControllerUsesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SharedDatasetsApi();

  const body = {
    // 'asset' | 'source'
    scopeType: scopeType_example,
    // string
    scopeId: scopeId_example,
  } satisfies SharedDatasetsControllerUsesRequest;

  try {
    const data = await api.sharedDatasetsControllerUses(body);
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
| **scopeType** | `asset`, `source` |  | [Defaults to `undefined`] [Enum: asset, source] |
| **scopeId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**Array&lt;SharedDatasetUseDto&gt;**](SharedDatasetUseDto.md)

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


## sharedDatasetsControllerVersions

> Array&lt;SharedDatasetVersionDto&gt; sharedDatasetsControllerVersions(id)

Every saved version of its definition

### Example

```ts
import {
  Configuration,
  SharedDatasetsApi,
} from '@workspace/api-client';
import type { SharedDatasetsControllerVersionsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SharedDatasetsApi();

  const body = {
    // string
    id: id_example,
  } satisfies SharedDatasetsControllerVersionsRequest;

  try {
    const data = await api.sharedDatasetsControllerVersions(body);
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

[**Array&lt;SharedDatasetVersionDto&gt;**](SharedDatasetVersionDto.md)

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

