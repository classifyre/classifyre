# NamespacesApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**namespacesControllerCreate**](NamespacesApi.md#namespacescontrollercreate) | **POST** /namespaces | Create a namespace (provisions its Postgres schema + migrations) |
| [**namespacesControllerGet**](NamespacesApi.md#namespacescontrollerget) | **GET** /namespaces/{id} | Get a namespace by id |
| [**namespacesControllerList**](NamespacesApi.md#namespacescontrollerlist) | **GET** /namespaces | List all namespaces |
| [**namespacesControllerRemove**](NamespacesApi.md#namespacescontrollerremove) | **DELETE** /namespaces/{id} | Soft-delete a namespace (hidden from listings; data retained) |
| [**namespacesControllerStats**](NamespacesApi.md#namespacescontrollerstats) | **GET** /namespaces/stats | Per-namespace source rollups (total + failing) |
| [**namespacesControllerThumbnail**](NamespacesApi.md#namespacescontrollerthumbnail) | **GET** /namespaces/{id}/thumbnail | Stream a namespace\&#39;s thumbnail image |
| [**namespacesControllerUpdate**](NamespacesApi.md#namespacescontrollerupdate) | **PATCH** /namespaces/{id} | Update a namespace |



## namespacesControllerCreate

> namespacesControllerCreate()

Create a namespace (provisions its Postgres schema + migrations)

### Example

```ts
import {
  Configuration,
  NamespacesApi,
} from '@workspace/api-client';
import type { NamespacesControllerCreateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new NamespacesApi();

  try {
    const data = await api.namespacesControllerCreate();
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
| **201** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## namespacesControllerGet

> namespacesControllerGet(id)

Get a namespace by id

### Example

```ts
import {
  Configuration,
  NamespacesApi,
} from '@workspace/api-client';
import type { NamespacesControllerGetRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new NamespacesApi();

  const body = {
    // string
    id: id_example,
  } satisfies NamespacesControllerGetRequest;

  try {
    const data = await api.namespacesControllerGet(body);
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


## namespacesControllerList

> namespacesControllerList()

List all namespaces

### Example

```ts
import {
  Configuration,
  NamespacesApi,
} from '@workspace/api-client';
import type { NamespacesControllerListRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new NamespacesApi();

  try {
    const data = await api.namespacesControllerList();
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


## namespacesControllerRemove

> namespacesControllerRemove(id)

Soft-delete a namespace (hidden from listings; data retained)

### Example

```ts
import {
  Configuration,
  NamespacesApi,
} from '@workspace/api-client';
import type { NamespacesControllerRemoveRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new NamespacesApi();

  const body = {
    // string
    id: id_example,
  } satisfies NamespacesControllerRemoveRequest;

  try {
    const data = await api.namespacesControllerRemove(body);
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


## namespacesControllerStats

> namespacesControllerStats()

Per-namespace source rollups (total + failing)

### Example

```ts
import {
  Configuration,
  NamespacesApi,
} from '@workspace/api-client';
import type { NamespacesControllerStatsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new NamespacesApi();

  try {
    const data = await api.namespacesControllerStats();
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


## namespacesControllerThumbnail

> namespacesControllerThumbnail(id)

Stream a namespace\&#39;s thumbnail image

### Example

```ts
import {
  Configuration,
  NamespacesApi,
} from '@workspace/api-client';
import type { NamespacesControllerThumbnailRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new NamespacesApi();

  const body = {
    // string
    id: id_example,
  } satisfies NamespacesControllerThumbnailRequest;

  try {
    const data = await api.namespacesControllerThumbnail(body);
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


## namespacesControllerUpdate

> namespacesControllerUpdate(id)

Update a namespace

### Example

```ts
import {
  Configuration,
  NamespacesApi,
} from '@workspace/api-client';
import type { NamespacesControllerUpdateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new NamespacesApi();

  const body = {
    // string
    id: id_example,
  } satisfies NamespacesControllerUpdateRequest;

  try {
    const data = await api.namespacesControllerUpdate(body);
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

