# RunnersApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**cliRunnerControllerAugmentEdges**](RunnersApi.md#clirunnercontrolleraugmentedges) | **POST** /runners/{runnerId}/augmentations/edges | Link assets and glossary terms, for a running connector |
| [**cliRunnerControllerAugmentTags**](RunnersApi.md#clirunnercontrolleraugmenttags) | **POST** /runners/{runnerId}/augmentations/tags | Tag assets of other sources, for a running connector |
| [**cliRunnerControllerBulkDeleteRunners**](RunnersApi.md#clirunnercontrollerbulkdeleterunners) | **POST** /runners/bulk-delete | Delete many scan records at once |
| [**cliRunnerControllerBulkRerunScans**](RunnersApi.md#clirunnercontrollerbulkrerunscans) | **POST** /runners/bulk-rerun | Start a fresh scan for many runs at once |
| [**cliRunnerControllerBulkStopRunners**](RunnersApi.md#clirunnercontrollerbulkstoprunners) | **POST** /runners/bulk-stop | Stop many scans at once |
| [**cliRunnerControllerCreateExternalRunner**](RunnersApi.md#clirunnercontrollercreateexternalrunner) | **POST** /sources/{sourceId}/runners/external | Create runner record for external CLI REST ingestion |
| [**cliRunnerControllerDeleteRunner**](RunnersApi.md#clirunnercontrollerdeleterunner) | **DELETE** /runners/{runnerId} | Delete runner metadata and cleanup filesystem logs for this runner |
| [**cliRunnerControllerFinishAugmentation**](RunnersApi.md#clirunnercontrollerfinishaugmentation) | **POST** /runners/{runnerId}/augmentations/finish | Retire what this source stopped asserting |
| [**cliRunnerControllerGetRunner**](RunnersApi.md#clirunnercontrollergetrunner) | **GET** /runners/{runnerId} | Get runner status and details |
| [**cliRunnerControllerGetRunnerAssetProgress**](RunnersApi.md#clirunnercontrollergetrunnerassetprogress) | **GET** /runners/{runnerId}/assets/progress | Get runner asset processing progress |
| [**cliRunnerControllerGetRunnerQueuePosition**](RunnersApi.md#clirunnercontrollergetrunnerqueueposition) | **GET** /runners/{runnerId}/queue-position | Why a queued run has not started yet |
| [**cliRunnerControllerListRunners**](RunnersApi.md#clirunnercontrollerlistrunners) | **GET** /runners | List all runners |
| [**cliRunnerControllerListSourceRunners**](RunnersApi.md#clirunnercontrollerlistsourcerunners) | **GET** /sources/{sourceId}/runners | List runners for source |
| [**cliRunnerControllerQueryAssets**](RunnersApi.md#clirunnercontrollerqueryassets) | **POST** /runners/{runnerId}/assets/query | Read assets of a source in this namespace, for a running connector |
| [**cliRunnerControllerQueryDetectors**](RunnersApi.md#clirunnercontrollerquerydetectors) | **POST** /runners/{runnerId}/detectors/query | List custom detectors, for a running connector |
| [**cliRunnerControllerQueryFindings**](RunnersApi.md#clirunnercontrollerqueryfindings) | **POST** /runners/{runnerId}/findings/query | Read findings of this namespace, for a running connector |
| [**cliRunnerControllerQuerySources**](RunnersApi.md#clirunnercontrollerquerysources) | **POST** /runners/{runnerId}/sources/query | List sources of this namespace, for a running connector |
| [**cliRunnerControllerRegisterDiscoveredAssets**](RunnersApi.md#clirunnercontrollerregisterdiscoveredassets) | **POST** /runners/{runnerId}/assets/discover | Register discovered asset hashes for a runner |
| [**cliRunnerControllerSearchRunnerLogs**](RunnersApi.md#clirunnercontrollersearchrunnerlogs) | **POST** /runners/{runnerId}/logs | Search runner logs with server-side filtering, full-text search, and sort |
| [**cliRunnerControllerStartRunner**](RunnersApi.md#clirunnercontrollerstartrunner) | **POST** /sources/{sourceId}/run | Start CLI runner for source |
| [**cliRunnerControllerStopRunner**](RunnersApi.md#clirunnercontrollerstoprunner) | **PATCH** /runners/{runnerId}/stop | Stop a running scan or cancel a queued one |
| [**cliRunnerControllerUpdateRunnerAssetStatuses**](RunnersApi.md#clirunnercontrollerupdaterunnerassetstatuses) | **PATCH** /runners/{runnerId}/assets/status | Update processing status of runner assets |
| [**cliRunnerControllerUpdateRunnerStatus**](RunnersApi.md#clirunnercontrollerupdaterunnerstatusoperation) | **PATCH** /runners/{runnerId}/status | Update runner status |
| [**searchRunnersControllerExportRunnerAssets**](RunnersApi.md#searchrunnerscontrollerexportrunnerassets) | **GET** /search/runner-assets/export | Export runner assets as CSV |
| [**searchRunnersControllerSearchRunnerAssets**](RunnersApi.md#searchrunnerscontrollersearchrunnerassets) | **POST** /search/runner-assets | Search runner assets |
| [**searchRunnersControllerSearchRunners**](RunnersApi.md#searchrunnerscontrollersearchrunners) | **POST** /search/runners | Search runners |
| [**searchRunnersControllerSearchRunnersCharts**](RunnersApi.md#searchrunnerscontrollersearchrunnerscharts) | **POST** /search/runners/charts | Runners charts overview |



## cliRunnerControllerAugmentEdges

> RunnerAugmentationResultDto cliRunnerControllerAugmentEdges(runnerId, runnerAugmentationEdgesDto)

Link assets and glossary terms, for a running connector

Backs ctx.link() and ctx.means(). Internal. Edges are stamped with the calling source and run; an edge another owner already holds is left alone.

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { CliRunnerControllerAugmentEdgesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // string
    runnerId: runnerId_example,
    // RunnerAugmentationEdgesDto
    runnerAugmentationEdgesDto: ...,
  } satisfies CliRunnerControllerAugmentEdgesRequest;

  try {
    const data = await api.cliRunnerControllerAugmentEdges(body);
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
| **runnerId** | `string` |  | [Defaults to `undefined`] |
| **runnerAugmentationEdgesDto** | [RunnerAugmentationEdgesDto](RunnerAugmentationEdgesDto.md) |  | |

### Return type

[**RunnerAugmentationResultDto**](RunnerAugmentationResultDto.md)

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


## cliRunnerControllerAugmentTags

> RunnerAugmentationResultDto cliRunnerControllerAugmentTags(runnerId, runnerAugmentationTagsDto)

Tag assets of other sources, for a running connector

Backs ctx.tag(). Internal. Each tag is a finding of an active Tag detector, stamped with the calling source and run so the same source can retire it later.

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { CliRunnerControllerAugmentTagsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // string
    runnerId: runnerId_example,
    // RunnerAugmentationTagsDto
    runnerAugmentationTagsDto: ...,
  } satisfies CliRunnerControllerAugmentTagsRequest;

  try {
    const data = await api.cliRunnerControllerAugmentTags(body);
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
| **runnerId** | `string` |  | [Defaults to `undefined`] |
| **runnerAugmentationTagsDto** | [RunnerAugmentationTagsDto](RunnerAugmentationTagsDto.md) |  | |

### Return type

[**RunnerAugmentationResultDto**](RunnerAugmentationResultDto.md)

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


## cliRunnerControllerBulkDeleteRunners

> BulkDeleteRunnersResponseDto cliRunnerControllerBulkDeleteRunners(bulkDeleteRunnersDto)

Delete many scan records at once

Deletes explicit runner IDs or every runner matching a search filter snapshot, including their stored logs. Runs still in flight are never deleted and are reported as skipped.

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { CliRunnerControllerBulkDeleteRunnersRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // BulkDeleteRunnersDto
    bulkDeleteRunnersDto: ...,
  } satisfies CliRunnerControllerBulkDeleteRunnersRequest;

  try {
    const data = await api.cliRunnerControllerBulkDeleteRunners(body);
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
| **bulkDeleteRunnersDto** | [BulkDeleteRunnersDto](BulkDeleteRunnersDto.md) |  | |

### Return type

[**BulkDeleteRunnersResponseDto**](BulkDeleteRunnersResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Runs deleted |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## cliRunnerControllerBulkRerunScans

> BulkRerunScansResponseDto cliRunnerControllerBulkRerunScans(bulkRerunScansDto)

Start a fresh scan for many runs at once

Starts a new MANUAL run for the source of each selected runner — explicit IDs or every runner matching a search filter snapshot. The old runs are history; the new ones queue as PENDING when the concurrency limit is reached. Sources already in flight are reported as skipped.

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { CliRunnerControllerBulkRerunScansRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // BulkRerunScansDto
    bulkRerunScansDto: ...,
  } satisfies CliRunnerControllerBulkRerunScansRequest;

  try {
    const data = await api.cliRunnerControllerBulkRerunScans(body);
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
| **bulkRerunScansDto** | [BulkRerunScansDto](BulkRerunScansDto.md) |  | |

### Return type

[**BulkRerunScansResponseDto**](BulkRerunScansResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Runs queued |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## cliRunnerControllerBulkStopRunners

> BulkStopRunnersResponseDto cliRunnerControllerBulkStopRunners(bulkStopRunnersDto)

Stop many scans at once

Stops explicit runner IDs or every runner matching a search filter snapshot. PENDING runs are cancelled outright, RUNNING ones are torn down; all end STOPPED. Runs that cannot be stopped (already terminal, managed externally) are reported as skipped.

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { CliRunnerControllerBulkStopRunnersRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // BulkStopRunnersDto
    bulkStopRunnersDto: ...,
  } satisfies CliRunnerControllerBulkStopRunnersRequest;

  try {
    const data = await api.cliRunnerControllerBulkStopRunners(body);
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
| **bulkStopRunnersDto** | [BulkStopRunnersDto](BulkStopRunnersDto.md) |  | |

### Return type

[**BulkStopRunnersResponseDto**](BulkStopRunnersResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Runs stopped |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## cliRunnerControllerCreateExternalRunner

> RunnerDto cliRunnerControllerCreateExternalRunner(sourceId, createExternalRunnerDto)

Create runner record for external CLI REST ingestion

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { CliRunnerControllerCreateExternalRunnerRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // string
    sourceId: sourceId_example,
    // CreateExternalRunnerDto (optional)
    createExternalRunnerDto: ...,
  } satisfies CliRunnerControllerCreateExternalRunnerRequest;

  try {
    const data = await api.cliRunnerControllerCreateExternalRunner(body);
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
| **createExternalRunnerDto** | [CreateExternalRunnerDto](CreateExternalRunnerDto.md) |  | [Optional] |

### Return type

[**RunnerDto**](RunnerDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** | External runner created successfully |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## cliRunnerControllerDeleteRunner

> DeleteRunnerResponseDto cliRunnerControllerDeleteRunner(runnerId)

Delete runner metadata and cleanup filesystem logs for this runner

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { CliRunnerControllerDeleteRunnerRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // string
    runnerId: runnerId_example,
  } satisfies CliRunnerControllerDeleteRunnerRequest;

  try {
    const data = await api.cliRunnerControllerDeleteRunner(body);
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
| **runnerId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**DeleteRunnerResponseDto**](DeleteRunnerResponseDto.md)

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


## cliRunnerControllerFinishAugmentation

> RunnerAugmentationFinishDto cliRunnerControllerFinishAugmentation(runnerId)

Retire what this source stopped asserting

Called after a notebook finished augmenting without error: resolves tags and removes edges this source wrote in earlier runs and did not write in this one. Never touches rows written by anyone else.

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { CliRunnerControllerFinishAugmentationRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // string
    runnerId: runnerId_example,
  } satisfies CliRunnerControllerFinishAugmentationRequest;

  try {
    const data = await api.cliRunnerControllerFinishAugmentation(body);
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
| **runnerId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**RunnerAugmentationFinishDto**](RunnerAugmentationFinishDto.md)

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


## cliRunnerControllerGetRunner

> RunnerDto cliRunnerControllerGetRunner(runnerId)

Get runner status and details

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { CliRunnerControllerGetRunnerRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // string
    runnerId: runnerId_example,
  } satisfies CliRunnerControllerGetRunnerRequest;

  try {
    const data = await api.cliRunnerControllerGetRunner(body);
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
| **runnerId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**RunnerDto**](RunnerDto.md)

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


## cliRunnerControllerGetRunnerAssetProgress

> RunnerAssetProgressDto cliRunnerControllerGetRunnerAssetProgress(runnerId)

Get runner asset processing progress

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { CliRunnerControllerGetRunnerAssetProgressRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // string
    runnerId: runnerId_example,
  } satisfies CliRunnerControllerGetRunnerAssetProgressRequest;

  try {
    const data = await api.cliRunnerControllerGetRunnerAssetProgress(body);
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
| **runnerId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**RunnerAssetProgressDto**](RunnerAssetProgressDto.md)

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


## cliRunnerControllerGetRunnerQueuePosition

> RunnerQueuePositionDto cliRunnerControllerGetRunnerQueuePosition(runnerId)

Why a queued run has not started yet

Place in this workspace\&#39;s queue, whether the run is in the priority lane, how many scans are running across the deployment, and the concurrency limit. All nulls once the run has left the queue.

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { CliRunnerControllerGetRunnerQueuePositionRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // string
    runnerId: runnerId_example,
  } satisfies CliRunnerControllerGetRunnerQueuePositionRequest;

  try {
    const data = await api.cliRunnerControllerGetRunnerQueuePosition(body);
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
| **runnerId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**RunnerQueuePositionDto**](RunnerQueuePositionDto.md)

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


## cliRunnerControllerListRunners

> ListRunnersResponseDto cliRunnerControllerListRunners(sourceId, status, skip, take)

List all runners

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { CliRunnerControllerListRunnersRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // string (optional)
    sourceId: sourceId_example,
    // 'PENDING' | 'RUNNING' | 'COMPLETED' | 'WARNING' | 'ERROR' | 'STOPPED' (optional)
    status: status_example,
    // number (optional)
    skip: 8.14,
    // number (optional)
    take: 8.14,
  } satisfies CliRunnerControllerListRunnersRequest;

  try {
    const data = await api.cliRunnerControllerListRunners(body);
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
| **sourceId** | `string` |  | [Optional] [Defaults to `undefined`] |
| **status** | `PENDING`, `RUNNING`, `COMPLETED`, `WARNING`, `ERROR`, `STOPPED` |  | [Optional] [Defaults to `undefined`] [Enum: PENDING, RUNNING, COMPLETED, WARNING, ERROR, STOPPED] |
| **skip** | `number` |  | [Optional] [Defaults to `0`] |
| **take** | `number` |  | [Optional] [Defaults to `20`] |

### Return type

[**ListRunnersResponseDto**](ListRunnersResponseDto.md)

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


## cliRunnerControllerListSourceRunners

> ListRunnersResponseDto cliRunnerControllerListSourceRunners(sourceId, sourceId2, status, skip, take)

List runners for source

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { CliRunnerControllerListSourceRunnersRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // string
    sourceId: sourceId_example,
    // string (optional)
    sourceId2: sourceId_example,
    // 'PENDING' | 'RUNNING' | 'COMPLETED' | 'WARNING' | 'ERROR' | 'STOPPED' (optional)
    status: status_example,
    // number (optional)
    skip: 8.14,
    // number (optional)
    take: 8.14,
  } satisfies CliRunnerControllerListSourceRunnersRequest;

  try {
    const data = await api.cliRunnerControllerListSourceRunners(body);
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
| **sourceId2** | `string` |  | [Optional] [Defaults to `undefined`] |
| **status** | `PENDING`, `RUNNING`, `COMPLETED`, `WARNING`, `ERROR`, `STOPPED` |  | [Optional] [Defaults to `undefined`] [Enum: PENDING, RUNNING, COMPLETED, WARNING, ERROR, STOPPED] |
| **skip** | `number` |  | [Optional] [Defaults to `0`] |
| **take** | `number` |  | [Optional] [Defaults to `20`] |

### Return type

[**ListRunnersResponseDto**](ListRunnersResponseDto.md)

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


## cliRunnerControllerQueryAssets

> RunnerAssetQueryResponseDto cliRunnerControllerQueryAssets(runnerId, runnerAssetQueryDto)

Read assets of a source in this namespace, for a running connector

Backs ctx.query_assets() in CUSTOM notebooks. Internal: the CLI relays the call so the notebook never holds API credentials. Only while the run is RUNNING; every read pages by cursor, at most 5,000 assets per page, 15 s per query.

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { CliRunnerControllerQueryAssetsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // string
    runnerId: runnerId_example,
    // RunnerAssetQueryDto
    runnerAssetQueryDto: ...,
  } satisfies CliRunnerControllerQueryAssetsRequest;

  try {
    const data = await api.cliRunnerControllerQueryAssets(body);
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
| **runnerId** | `string` |  | [Defaults to `undefined`] |
| **runnerAssetQueryDto** | [RunnerAssetQueryDto](RunnerAssetQueryDto.md) |  | |

### Return type

[**RunnerAssetQueryResponseDto**](RunnerAssetQueryResponseDto.md)

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


## cliRunnerControllerQueryDetectors

> RunnerDetectorQueryResponseDto cliRunnerControllerQueryDetectors(runnerId, runnerDetectorQueryDto)

List custom detectors, for a running connector

Backs ctx.query_detectors(). Internal. Never returns a detector pipeline or its secrets.

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { CliRunnerControllerQueryDetectorsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // string
    runnerId: runnerId_example,
    // RunnerDetectorQueryDto
    runnerDetectorQueryDto: ...,
  } satisfies CliRunnerControllerQueryDetectorsRequest;

  try {
    const data = await api.cliRunnerControllerQueryDetectors(body);
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
| **runnerId** | `string` |  | [Defaults to `undefined`] |
| **runnerDetectorQueryDto** | [RunnerDetectorQueryDto](RunnerDetectorQueryDto.md) |  | |

### Return type

[**RunnerDetectorQueryResponseDto**](RunnerDetectorQueryResponseDto.md)

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


## cliRunnerControllerQueryFindings

> RunnerFindingQueryResponseDto cliRunnerControllerQueryFindings(runnerId, runnerFindingQueryDto)

Read findings of this namespace, for a running connector

Backs ctx.query_findings(). Internal. Filter by detector, type, severity, status, source or asset; pages by cursor, at most 5,000 per page.

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { CliRunnerControllerQueryFindingsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // string
    runnerId: runnerId_example,
    // RunnerFindingQueryDto
    runnerFindingQueryDto: ...,
  } satisfies CliRunnerControllerQueryFindingsRequest;

  try {
    const data = await api.cliRunnerControllerQueryFindings(body);
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
| **runnerId** | `string` |  | [Defaults to `undefined`] |
| **runnerFindingQueryDto** | [RunnerFindingQueryDto](RunnerFindingQueryDto.md) |  | |

### Return type

[**RunnerFindingQueryResponseDto**](RunnerFindingQueryResponseDto.md)

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


## cliRunnerControllerQuerySources

> RunnerSourceQueryResponseDto cliRunnerControllerQuerySources(runnerId, runnerSourceQueryDto)

List sources of this namespace, for a running connector

Backs ctx.query_sources() in CUSTOM notebooks. Internal. Never returns a source configuration. Pages by cursor, at most 5,000 per page.

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { CliRunnerControllerQuerySourcesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // string
    runnerId: runnerId_example,
    // RunnerSourceQueryDto
    runnerSourceQueryDto: ...,
  } satisfies CliRunnerControllerQuerySourcesRequest;

  try {
    const data = await api.cliRunnerControllerQuerySources(body);
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
| **runnerId** | `string` |  | [Defaults to `undefined`] |
| **runnerSourceQueryDto** | [RunnerSourceQueryDto](RunnerSourceQueryDto.md) |  | |

### Return type

[**RunnerSourceQueryResponseDto**](RunnerSourceQueryResponseDto.md)

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


## cliRunnerControllerRegisterDiscoveredAssets

> RegisterDiscoveredAssetsResponseDto cliRunnerControllerRegisterDiscoveredAssets(runnerId, registerDiscoveredAssetsDto)

Register discovered asset hashes for a runner

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { CliRunnerControllerRegisterDiscoveredAssetsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // string
    runnerId: runnerId_example,
    // RegisterDiscoveredAssetsDto
    registerDiscoveredAssetsDto: ...,
  } satisfies CliRunnerControllerRegisterDiscoveredAssetsRequest;

  try {
    const data = await api.cliRunnerControllerRegisterDiscoveredAssets(body);
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
| **runnerId** | `string` |  | [Defaults to `undefined`] |
| **registerDiscoveredAssetsDto** | [RegisterDiscoveredAssetsDto](RegisterDiscoveredAssetsDto.md) |  | |

### Return type

[**RegisterDiscoveredAssetsResponseDto**](RegisterDiscoveredAssetsResponseDto.md)

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


## cliRunnerControllerSearchRunnerLogs

> RunnerLogsResponseDto cliRunnerControllerSearchRunnerLogs(runnerId, searchRunnerLogsBodyDto)

Search runner logs with server-side filtering, full-text search, and sort

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { CliRunnerControllerSearchRunnerLogsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // string
    runnerId: runnerId_example,
    // SearchRunnerLogsBodyDto
    searchRunnerLogsBodyDto: ...,
  } satisfies CliRunnerControllerSearchRunnerLogsRequest;

  try {
    const data = await api.cliRunnerControllerSearchRunnerLogs(body);
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
| **runnerId** | `string` |  | [Defaults to `undefined`] |
| **searchRunnerLogsBodyDto** | [SearchRunnerLogsBodyDto](SearchRunnerLogsBodyDto.md) |  | |

### Return type

[**RunnerLogsResponseDto**](RunnerLogsResponseDto.md)

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


## cliRunnerControllerStartRunner

> RunnerDto cliRunnerControllerStartRunner(sourceId, startRunnerDto)

Start CLI runner for source

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { CliRunnerControllerStartRunnerRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // string
    sourceId: sourceId_example,
    // StartRunnerDto (optional)
    startRunnerDto: ...,
  } satisfies CliRunnerControllerStartRunnerRequest;

  try {
    const data = await api.cliRunnerControllerStartRunner(body);
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
| **startRunnerDto** | [StartRunnerDto](StartRunnerDto.md) |  | [Optional] |

### Return type

[**RunnerDto**](RunnerDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** | Runner started successfully |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## cliRunnerControllerStopRunner

> StopRunnerResponseDto cliRunnerControllerStopRunner(runnerId)

Stop a running scan or cancel a queued one

A RUNNING scan is torn down and a PENDING (queued) one is cancelled outright. Both end STOPPED with \&quot;Manually stopped\&quot;: the source is released, its last-run bookkeeping records the decision (a queued run never consumed its window, so its last-run clock is left alone), the adaptive scheduler is kicked via pg-boss, and the next queued scan is promoted.

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { CliRunnerControllerStopRunnerRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // string
    runnerId: runnerId_example,
  } satisfies CliRunnerControllerStopRunnerRequest;

  try {
    const data = await api.cliRunnerControllerStopRunner(body);
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
| **runnerId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**StopRunnerResponseDto**](StopRunnerResponseDto.md)

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


## cliRunnerControllerUpdateRunnerAssetStatuses

> cliRunnerControllerUpdateRunnerAssetStatuses(runnerId, updateRunnerAssetStatusDto)

Update processing status of runner assets

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { CliRunnerControllerUpdateRunnerAssetStatusesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // string
    runnerId: runnerId_example,
    // UpdateRunnerAssetStatusDto
    updateRunnerAssetStatusDto: ...,
  } satisfies CliRunnerControllerUpdateRunnerAssetStatusesRequest;

  try {
    const data = await api.cliRunnerControllerUpdateRunnerAssetStatuses(body);
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
| **runnerId** | `string` |  | [Defaults to `undefined`] |
| **updateRunnerAssetStatusDto** | [UpdateRunnerAssetStatusDto](UpdateRunnerAssetStatusDto.md) |  | |

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


## cliRunnerControllerUpdateRunnerStatus

> cliRunnerControllerUpdateRunnerStatus(runnerId, cliRunnerControllerUpdateRunnerStatusRequest)

Update runner status

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { CliRunnerControllerUpdateRunnerStatusOperationRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // string
    runnerId: runnerId_example,
    // CliRunnerControllerUpdateRunnerStatusRequest
    cliRunnerControllerUpdateRunnerStatusRequest: ...,
  } satisfies CliRunnerControllerUpdateRunnerStatusOperationRequest;

  try {
    const data = await api.cliRunnerControllerUpdateRunnerStatus(body);
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
| **runnerId** | `string` |  | [Defaults to `undefined`] |
| **cliRunnerControllerUpdateRunnerStatusRequest** | [CliRunnerControllerUpdateRunnerStatusRequest](CliRunnerControllerUpdateRunnerStatusRequest.md) |  | |

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


## searchRunnersControllerExportRunnerAssets

> Blob searchRunnersControllerExportRunnerAssets(runnerId, search, status)

Export runner assets as CSV

Streams runner_assets rows for a runner matching the current filters as a CSV download.

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { SearchRunnersControllerExportRunnerAssetsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // string (optional)
    runnerId: runnerId_example,
    // string (optional)
    search: search_example,
    // Array<'PENDING' | 'PROCESSING' | 'PROCESSED' | 'ERROR'> (optional)
    status: ...,
  } satisfies SearchRunnersControllerExportRunnerAssetsRequest;

  try {
    const data = await api.searchRunnersControllerExportRunnerAssets(body);
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
| **runnerId** | `string` |  | [Optional] [Defaults to `undefined`] |
| **search** | `string` |  | [Optional] [Defaults to `undefined`] |
| **status** | `PENDING`, `PROCESSING`, `PROCESSED`, `ERROR` |  | [Optional] [Enum: PENDING, PROCESSING, PROCESSED, ERROR] |

### Return type

**Blob**

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `text/csv`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | CSV stream of runner assets |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## searchRunnersControllerSearchRunnerAssets

> SearchRunnersAssetsResponseDto searchRunnersControllerSearchRunnerAssets(searchRunnersAssetsRequestDto)

Search runner assets

Returns paginated runner_assets rows for a specific runner, joined with the resolved asset record and its findings.

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { SearchRunnersControllerSearchRunnerAssetsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // SearchRunnersAssetsRequestDto
    searchRunnersAssetsRequestDto: ...,
  } satisfies SearchRunnersControllerSearchRunnerAssetsRequest;

  try {
    const data = await api.searchRunnersControllerSearchRunnerAssets(body);
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
| **searchRunnersAssetsRequestDto** | [SearchRunnersAssetsRequestDto](SearchRunnersAssetsRequestDto.md) |  | |

### Return type

[**SearchRunnersAssetsResponseDto**](SearchRunnersAssetsResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Paginated runner assets with joined asset and findings data |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## searchRunnersControllerSearchRunners

> SearchRunnersResponseDto searchRunnersControllerSearchRunners(searchRunnersRequestDto)

Search runners

Search paginated runners with nested body filters and server-side sorting.

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { SearchRunnersControllerSearchRunnersRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // SearchRunnersRequestDto
    searchRunnersRequestDto: ...,
  } satisfies SearchRunnersControllerSearchRunnersRequest;

  try {
    const data = await api.searchRunnersControllerSearchRunners(body);
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
| **searchRunnersRequestDto** | [SearchRunnersRequestDto](SearchRunnersRequestDto.md) |  | |

### Return type

[**SearchRunnersResponseDto**](SearchRunnersResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Search results containing runners |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## searchRunnersControllerSearchRunnersCharts

> SearchRunnersChartsResponseDto searchRunnersControllerSearchRunnersCharts(searchRunnersChartsRequestDto)

Runners charts overview

Returns totals, status timeline, and top sources for runners in a single response.

### Example

```ts
import {
  Configuration,
  RunnersApi,
} from '@workspace/api-client';
import type { SearchRunnersControllerSearchRunnersChartsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new RunnersApi();

  const body = {
    // SearchRunnersChartsRequestDto
    searchRunnersChartsRequestDto: ...,
  } satisfies SearchRunnersControllerSearchRunnersChartsRequest;

  try {
    const data = await api.searchRunnersControllerSearchRunnersCharts(body);
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
| **searchRunnersChartsRequestDto** | [SearchRunnersChartsRequestDto](SearchRunnersChartsRequestDto.md) |  | |

### Return type

[**SearchRunnersChartsResponseDto**](SearchRunnersChartsResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Chart overview containing totals, timeline and top sources |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

