# CaseBoardApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**caseBoardControllerApplyOps**](CaseBoardApi.md#caseboardcontrollerapplyops) | **POST** /cases/{id}/board/ops | Apply a batch of board ops in one transaction; refused ops are reported per op |
| [**caseBoardControllerGet**](CaseBoardApi.md#caseboardcontrollerget) | **GET** /cases/{id}/board | The case board: items, links, evidence, the live graph layer, stances and thread summaries |
| [**caseBoardControllerGetSnapshot**](CaseBoardApi.md#caseboardcontrollergetsnapshot) | **GET** /cases/{id}/board/snapshots/{snapshotId} | One board snapshot, exactly as it was captured |
| [**caseBoardControllerListSnapshots**](CaseBoardApi.md#caseboardcontrollerlistsnapshots) | **GET** /cases/{id}/board/snapshots | Board snapshots, newest first |
| [**caseBoardControllerNeighbours**](CaseBoardApi.md#caseboardcontrollerneighbours) | **POST** /cases/{id}/board/neighbours | Live depth-1 neighbourhood of one evidence bubble (drawn as suggested items) |
| [**caseBoardControllerTakeSnapshot**](CaseBoardApi.md#caseboardcontrollertakesnapshot) | **POST** /cases/{id}/board/snapshots | Capture the board as it is now |
| [**caseBoardControllerTrace**](CaseBoardApi.md#caseboardcontrollertrace) | **POST** /cases/{id}/board/trace | Trace assets\&#39; connections: upstream, downstream and sideways through lineage, links, duplicates and similarity |



## caseBoardControllerApplyOps

> ApplyBoardOpsResponseDto caseBoardControllerApplyOps(id, applyBoardOpsDto)

Apply a batch of board ops in one transaction; refused ops are reported per op

### Example

```ts
import {
  Configuration,
  CaseBoardApi,
} from '@workspace/api-client';
import type { CaseBoardControllerApplyOpsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CaseBoardApi();

  const body = {
    // string
    id: id_example,
    // ApplyBoardOpsDto
    applyBoardOpsDto: ...,
  } satisfies CaseBoardControllerApplyOpsRequest;

  try {
    const data = await api.caseBoardControllerApplyOps(body);
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
| **applyBoardOpsDto** | [ApplyBoardOpsDto](ApplyBoardOpsDto.md) |  | |

### Return type

[**ApplyBoardOpsResponseDto**](ApplyBoardOpsResponseDto.md)

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


## caseBoardControllerGet

> CaseBoardResponseDto caseBoardControllerGet(id)

The case board: items, links, evidence, the live graph layer, stances and thread summaries

### Example

```ts
import {
  Configuration,
  CaseBoardApi,
} from '@workspace/api-client';
import type { CaseBoardControllerGetRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CaseBoardApi();

  const body = {
    // string
    id: id_example,
  } satisfies CaseBoardControllerGetRequest;

  try {
    const data = await api.caseBoardControllerGet(body);
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

[**CaseBoardResponseDto**](CaseBoardResponseDto.md)

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


## caseBoardControllerGetSnapshot

> CaseBoardSnapshotDto caseBoardControllerGetSnapshot(id, snapshotId)

One board snapshot, exactly as it was captured

### Example

```ts
import {
  Configuration,
  CaseBoardApi,
} from '@workspace/api-client';
import type { CaseBoardControllerGetSnapshotRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CaseBoardApi();

  const body = {
    // string
    id: id_example,
    // string
    snapshotId: snapshotId_example,
  } satisfies CaseBoardControllerGetSnapshotRequest;

  try {
    const data = await api.caseBoardControllerGetSnapshot(body);
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
| **snapshotId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**CaseBoardSnapshotDto**](CaseBoardSnapshotDto.md)

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


## caseBoardControllerListSnapshots

> Array&lt;CaseBoardSnapshotSummaryDto&gt; caseBoardControllerListSnapshots(id)

Board snapshots, newest first

### Example

```ts
import {
  Configuration,
  CaseBoardApi,
} from '@workspace/api-client';
import type { CaseBoardControllerListSnapshotsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CaseBoardApi();

  const body = {
    // string
    id: id_example,
  } satisfies CaseBoardControllerListSnapshotsRequest;

  try {
    const data = await api.caseBoardControllerListSnapshots(body);
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

[**Array&lt;CaseBoardSnapshotSummaryDto&gt;**](CaseBoardSnapshotSummaryDto.md)

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


## caseBoardControllerNeighbours

> GraphResponseDto caseBoardControllerNeighbours(id, boardNeighboursDto)

Live depth-1 neighbourhood of one evidence bubble (drawn as suggested items)

### Example

```ts
import {
  Configuration,
  CaseBoardApi,
} from '@workspace/api-client';
import type { CaseBoardControllerNeighboursRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CaseBoardApi();

  const body = {
    // string
    id: id_example,
    // BoardNeighboursDto
    boardNeighboursDto: ...,
  } satisfies CaseBoardControllerNeighboursRequest;

  try {
    const data = await api.caseBoardControllerNeighbours(body);
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
| **boardNeighboursDto** | [BoardNeighboursDto](BoardNeighboursDto.md) |  | |

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


## caseBoardControllerTakeSnapshot

> CaseBoardSnapshotSummaryDto caseBoardControllerTakeSnapshot(id)

Capture the board as it is now

### Example

```ts
import {
  Configuration,
  CaseBoardApi,
} from '@workspace/api-client';
import type { CaseBoardControllerTakeSnapshotRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CaseBoardApi();

  const body = {
    // string
    id: id_example,
  } satisfies CaseBoardControllerTakeSnapshotRequest;

  try {
    const data = await api.caseBoardControllerTakeSnapshot(body);
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

[**CaseBoardSnapshotSummaryDto**](CaseBoardSnapshotSummaryDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## caseBoardControllerTrace

> BoardTraceResponseDto caseBoardControllerTrace(id, boardTraceRequestDto)

Trace assets\&#39; connections: upstream, downstream and sideways through lineage, links, duplicates and similarity

### Example

```ts
import {
  Configuration,
  CaseBoardApi,
} from '@workspace/api-client';
import type { CaseBoardControllerTraceRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CaseBoardApi();

  const body = {
    // string
    id: id_example,
    // BoardTraceRequestDto
    boardTraceRequestDto: ...,
  } satisfies CaseBoardControllerTraceRequest;

  try {
    const data = await api.caseBoardControllerTrace(body);
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
| **boardTraceRequestDto** | [BoardTraceRequestDto](BoardTraceRequestDto.md) |  | |

### Return type

[**BoardTraceResponseDto**](BoardTraceResponseDto.md)

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

