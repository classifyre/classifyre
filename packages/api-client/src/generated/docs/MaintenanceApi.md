# MaintenanceApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**maintenanceControllerCleanupRun**](MaintenanceApi.md#maintenancecontrollercleanuprun) | **GET** /maintenance/cleanup/runs/{runId} | Poll one cleanup run: rows removed so far, current table, and the final result once done |
| [**maintenanceControllerListFeatures**](MaintenanceApi.md#maintenancecontrollerlistfeatures) | **GET** /maintenance/features | Workspace feature switches (embeddings, duplicate detection): state, how each was turned off, the data each owns and the queues held while off |
| [**maintenanceControllerOverview**](MaintenanceApi.md#maintenancecontrolleroverview) | **GET** /maintenance/overview | Workspace storage overview: per-table row estimates and byte sizes, grouped into protected and cleanable datasets |
| [**maintenanceControllerSetFeature**](MaintenanceApi.md#maintenancecontrollersetfeature) | **PUT** /maintenance/features/{key} | Turn a workspace feature on or off. Off holds its worker queues paused (every replica stops; the Workers tab cannot resume them) and either keeps its data (a pause — turning back on catches up) or, with deleteData, wipes it in the background (poll GET cleanup/runs/:runId). On resumes the queues and catches up: one full duplicate recompute, or an embedding backfill. Body: { enabled: boolean, deleteData?: boolean }. Allowed while the workspace is paused. |
| [**maintenanceControllerStartCleanup**](MaintenanceApi.md#maintenancecontrollerstartcleanup) | **POST** /maintenance/cleanup/{key} | Start wiping one cleanable dataset in the background (scan history, duplicates, embeddings, harness runs, finished queue jobs, derived stats/graph, finished transfers). Protected data is never accepted here. Poll GET cleanup/runs/:runId for progress. Deliberately allowed while paused: freezing the workers first is the recommended quiet window (pause, clean, resume), since no writer can race the wipe. |



## maintenanceControllerCleanupRun

> maintenanceControllerCleanupRun(runId)

Poll one cleanup run: rows removed so far, current table, and the final result once done

### Example

```ts
import {
  Configuration,
  MaintenanceApi,
} from '@workspace/api-client';
import type { MaintenanceControllerCleanupRunRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new MaintenanceApi();

  const body = {
    // string
    runId: runId_example,
  } satisfies MaintenanceControllerCleanupRunRequest;

  try {
    const data = await api.maintenanceControllerCleanupRun(body);
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
| **runId** | `string` |  | [Defaults to `undefined`] |

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
| **404** | Unknown or expired run id |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## maintenanceControllerListFeatures

> maintenanceControllerListFeatures()

Workspace feature switches (embeddings, duplicate detection): state, how each was turned off, the data each owns and the queues held while off

### Example

```ts
import {
  Configuration,
  MaintenanceApi,
} from '@workspace/api-client';
import type { MaintenanceControllerListFeaturesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new MaintenanceApi();

  try {
    const data = await api.maintenanceControllerListFeatures();
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


## maintenanceControllerOverview

> maintenanceControllerOverview()

Workspace storage overview: per-table row estimates and byte sizes, grouped into protected and cleanable datasets

### Example

```ts
import {
  Configuration,
  MaintenanceApi,
} from '@workspace/api-client';
import type { MaintenanceControllerOverviewRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new MaintenanceApi();

  try {
    const data = await api.maintenanceControllerOverview();
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


## maintenanceControllerSetFeature

> maintenanceControllerSetFeature(key)

Turn a workspace feature on or off. Off holds its worker queues paused (every replica stops; the Workers tab cannot resume them) and either keeps its data (a pause — turning back on catches up) or, with deleteData, wipes it in the background (poll GET cleanup/runs/:runId). On resumes the queues and catches up: one full duplicate recompute, or an embedding backfill. Body: { enabled: boolean, deleteData?: boolean }. Allowed while the workspace is paused.

### Example

```ts
import {
  Configuration,
  MaintenanceApi,
} from '@workspace/api-client';
import type { MaintenanceControllerSetFeatureRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new MaintenanceApi();

  const body = {
    // string
    key: key_example,
  } satisfies MaintenanceControllerSetFeatureRequest;

  try {
    const data = await api.maintenanceControllerSetFeature(body);
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
| **key** | `string` |  | [Defaults to `undefined`] |

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
| **400** | Malformed body |  -  |
| **404** | Unknown feature |  -  |
| **409** | The feature\&#39;s data is being deleted right now |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## maintenanceControllerStartCleanup

> maintenanceControllerStartCleanup(key)

Start wiping one cleanable dataset in the background (scan history, duplicates, embeddings, harness runs, finished queue jobs, derived stats/graph, finished transfers). Protected data is never accepted here. Poll GET cleanup/runs/:runId for progress. Deliberately allowed while paused: freezing the workers first is the recommended quiet window (pause, clean, resume), since no writer can race the wipe.

### Example

```ts
import {
  Configuration,
  MaintenanceApi,
} from '@workspace/api-client';
import type { MaintenanceControllerStartCleanupRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new MaintenanceApi();

  const body = {
    // string
    key: key_example,
  } satisfies MaintenanceControllerStartCleanupRequest;

  try {
    const data = await api.maintenanceControllerStartCleanup(body);
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
| **key** | `string` |  | [Defaults to `undefined`] |

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
| **202** | Cleanup run started |  -  |
| **404** | Unknown cleanup key (incl. protected datasets) |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

