# ThreadsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**caseThreadsControllerAddEntry**](ThreadsApi.md#casethreadscontrolleraddentry) | **POST** /threads/{id}/entries | Add a note, statement revision, or status entry to a thread |
| [**caseThreadsControllerCreate**](ThreadsApi.md#casethreadscontrollercreate) | **POST** /cases/{caseId}/threads | Create a thread (hypothesis or discussion) |
| [**caseThreadsControllerGetEntries**](ThreadsApi.md#casethreadscontrollergetentries) | **GET** /threads/{id}/entries | Paginated thread entry history |
| [**caseThreadsControllerLinkSupport**](ThreadsApi.md#casethreadscontrollerlinksupport) | **POST** /threads/{id}/support | Link evidence or finding to a thread |
| [**caseThreadsControllerList**](ThreadsApi.md#casethreadscontrollerlist) | **GET** /cases/{caseId}/threads | List threads (hypothesis + discussion) for a case |
| [**caseThreadsControllerRemove**](ThreadsApi.md#casethreadscontrollerremove) | **DELETE** /threads/{id} | Delete a thread |
| [**caseThreadsControllerUnlinkSupport**](ThreadsApi.md#casethreadscontrollerunlinksupport) | **DELETE** /threads/{id}/support/{linkId} | Unlink evidence or finding from a thread |
| [**caseThreadsControllerUpdate**](ThreadsApi.md#casethreadscontrollerupdate) | **PATCH** /threads/{id} | Update thread title / status / confidence / color |



## caseThreadsControllerAddEntry

> ThreadResponseDto caseThreadsControllerAddEntry(id, addThreadEntryDto)

Add a note, statement revision, or status entry to a thread

### Example

```ts
import {
  Configuration,
  ThreadsApi,
} from '@workspace/api-client';
import type { CaseThreadsControllerAddEntryRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new ThreadsApi();

  const body = {
    // string
    id: id_example,
    // AddThreadEntryDto
    addThreadEntryDto: ...,
  } satisfies CaseThreadsControllerAddEntryRequest;

  try {
    const data = await api.caseThreadsControllerAddEntry(body);
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
| **addThreadEntryDto** | [AddThreadEntryDto](AddThreadEntryDto.md) |  | |

### Return type

[**ThreadResponseDto**](ThreadResponseDto.md)

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


## caseThreadsControllerCreate

> ThreadResponseDto caseThreadsControllerCreate(caseId, createThreadDto)

Create a thread (hypothesis or discussion)

### Example

```ts
import {
  Configuration,
  ThreadsApi,
} from '@workspace/api-client';
import type { CaseThreadsControllerCreateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new ThreadsApi();

  const body = {
    // string
    caseId: caseId_example,
    // CreateThreadDto
    createThreadDto: ...,
  } satisfies CaseThreadsControllerCreateRequest;

  try {
    const data = await api.caseThreadsControllerCreate(body);
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
| **caseId** | `string` |  | [Defaults to `undefined`] |
| **createThreadDto** | [CreateThreadDto](CreateThreadDto.md) |  | |

### Return type

[**ThreadResponseDto**](ThreadResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## caseThreadsControllerGetEntries

> ThreadEntriesResponseDto caseThreadsControllerGetEntries(id, cursor, limit)

Paginated thread entry history

### Example

```ts
import {
  Configuration,
  ThreadsApi,
} from '@workspace/api-client';
import type { CaseThreadsControllerGetEntriesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new ThreadsApi();

  const body = {
    // string
    id: id_example,
    // string (optional)
    cursor: cursor_example,
    // string (optional)
    limit: limit_example,
  } satisfies CaseThreadsControllerGetEntriesRequest;

  try {
    const data = await api.caseThreadsControllerGetEntries(body);
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
| **cursor** | `string` |  | [Optional] [Defaults to `undefined`] |
| **limit** | `string` |  | [Optional] [Defaults to `undefined`] |

### Return type

[**ThreadEntriesResponseDto**](ThreadEntriesResponseDto.md)

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


## caseThreadsControllerLinkSupport

> ThreadResponseDto caseThreadsControllerLinkSupport(id, linkThreadSupportDto)

Link evidence or finding to a thread

### Example

```ts
import {
  Configuration,
  ThreadsApi,
} from '@workspace/api-client';
import type { CaseThreadsControllerLinkSupportRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new ThreadsApi();

  const body = {
    // string
    id: id_example,
    // LinkThreadSupportDto
    linkThreadSupportDto: ...,
  } satisfies CaseThreadsControllerLinkSupportRequest;

  try {
    const data = await api.caseThreadsControllerLinkSupport(body);
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
| **linkThreadSupportDto** | [LinkThreadSupportDto](LinkThreadSupportDto.md) |  | |

### Return type

[**ThreadResponseDto**](ThreadResponseDto.md)

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


## caseThreadsControllerList

> Array&lt;ThreadResponseDto&gt; caseThreadsControllerList(caseId)

List threads (hypothesis + discussion) for a case

### Example

```ts
import {
  Configuration,
  ThreadsApi,
} from '@workspace/api-client';
import type { CaseThreadsControllerListRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new ThreadsApi();

  const body = {
    // string
    caseId: caseId_example,
  } satisfies CaseThreadsControllerListRequest;

  try {
    const data = await api.caseThreadsControllerList(body);
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
| **caseId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**Array&lt;ThreadResponseDto&gt;**](ThreadResponseDto.md)

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


## caseThreadsControllerRemove

> caseThreadsControllerRemove(id)

Delete a thread

### Example

```ts
import {
  Configuration,
  ThreadsApi,
} from '@workspace/api-client';
import type { CaseThreadsControllerRemoveRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new ThreadsApi();

  const body = {
    // string
    id: id_example,
  } satisfies CaseThreadsControllerRemoveRequest;

  try {
    const data = await api.caseThreadsControllerRemove(body);
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


## caseThreadsControllerUnlinkSupport

> ThreadResponseDto caseThreadsControllerUnlinkSupport(id, linkId)

Unlink evidence or finding from a thread

### Example

```ts
import {
  Configuration,
  ThreadsApi,
} from '@workspace/api-client';
import type { CaseThreadsControllerUnlinkSupportRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new ThreadsApi();

  const body = {
    // string
    id: id_example,
    // string
    linkId: linkId_example,
  } satisfies CaseThreadsControllerUnlinkSupportRequest;

  try {
    const data = await api.caseThreadsControllerUnlinkSupport(body);
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
| **linkId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**ThreadResponseDto**](ThreadResponseDto.md)

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


## caseThreadsControllerUpdate

> ThreadResponseDto caseThreadsControllerUpdate(id, updateThreadDto)

Update thread title / status / confidence / color

### Example

```ts
import {
  Configuration,
  ThreadsApi,
} from '@workspace/api-client';
import type { CaseThreadsControllerUpdateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new ThreadsApi();

  const body = {
    // string
    id: id_example,
    // UpdateThreadDto
    updateThreadDto: ...,
  } satisfies CaseThreadsControllerUpdateRequest;

  try {
    const data = await api.caseThreadsControllerUpdate(body);
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
| **updateThreadDto** | [UpdateThreadDto](UpdateThreadDto.md) |  | |

### Return type

[**ThreadResponseDto**](ThreadResponseDto.md)

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

