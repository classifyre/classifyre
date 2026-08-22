# WorkerQueuesApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**workerQueuesControllerOverview**](WorkerQueuesApi.md#workerqueuescontrolleroverview) | **GET** /worker-queues | List background queues with live worker state and backlog |
| [**workerQueuesControllerSetPaused**](WorkerQueuesApi.md#workerqueuescontrollersetpaused) | **PUT** /worker-queues/{queue}/paused | Pause or resume a background queue |



## workerQueuesControllerOverview

> WorkerOverviewDto workerQueuesControllerOverview()

List background queues with live worker state and backlog

Aggregates every worker process reporting on each queue. A row whose heartbeat has gone quiet is reported as stale rather than believed, so an OOM-killed pod cannot leave a queue looking busy forever.

### Example

```ts
import {
  Configuration,
  WorkerQueuesApi,
} from '@workspace/api-client';
import type { WorkerQueuesControllerOverviewRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new WorkerQueuesApi();

  try {
    const data = await api.workerQueuesControllerOverview();
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

[**WorkerOverviewDto**](WorkerOverviewDto.md)

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


## workerQueuesControllerSetPaused

> WorkerQueueDto workerQueuesControllerSetPaused(queue, setWorkerQueuePausedDto)

Pause or resume a background queue

Pausing is database-backed, so it applies to every worker replica rather than only the pod that served this request. A batch handed to a paused queue is refused and retried by pg-boss, so nothing is lost. Jobs already running cannot be cancelled — pause and let them drain, or restart the worker.

### Example

```ts
import {
  Configuration,
  WorkerQueuesApi,
} from '@workspace/api-client';
import type { WorkerQueuesControllerSetPausedRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new WorkerQueuesApi();

  const body = {
    // string
    queue: queue_example,
    // SetWorkerQueuePausedDto
    setWorkerQueuePausedDto: ...,
  } satisfies WorkerQueuesControllerSetPausedRequest;

  try {
    const data = await api.workerQueuesControllerSetPaused(body);
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
| **queue** | `string` |  | [Defaults to `undefined`] |
| **setWorkerQueuePausedDto** | [SetWorkerQueuePausedDto](SetWorkerQueuePausedDto.md) |  | |

### Return type

[**WorkerQueueDto**](WorkerQueueDto.md)

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

