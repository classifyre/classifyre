# RunnersApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**cliRunnerControllerCreateExternalRunner**](RunnersApi.md#clirunnercontrollercreateexternalrunner) | **POST** /sources/{sourceId}/runners/external | Create runner record for external CLI REST ingestion |
| [**cliRunnerControllerDeleteRunner**](RunnersApi.md#clirunnercontrollerdeleterunner) | **DELETE** /runners/{runnerId} | Delete runner metadata and cleanup filesystem logs for this runner |
| [**cliRunnerControllerGetRunner**](RunnersApi.md#clirunnercontrollergetrunner) | **GET** /runners/{runnerId} | Get runner status and details |
| [**cliRunnerControllerGetRunnerAssetProgress**](RunnersApi.md#clirunnercontrollergetrunnerassetprogress) | **GET** /runners/{runnerId}/assets/progress | Get runner asset processing progress |
| [**cliRunnerControllerListRunners**](RunnersApi.md#clirunnercontrollerlistrunners) | **GET** /runners | List all runners |
| [**cliRunnerControllerListSourceRunners**](RunnersApi.md#clirunnercontrollerlistsourcerunners) | **GET** /sources/{sourceId}/runners | List runners for source |
| [**cliRunnerControllerRegisterDiscoveredAssets**](RunnersApi.md#clirunnercontrollerregisterdiscoveredassets) | **POST** /runners/{runnerId}/assets/discover | Register discovered asset hashes for a runner |
| [**cliRunnerControllerSearchRunnerLogs**](RunnersApi.md#clirunnercontrollersearchrunnerlogs) | **POST** /runners/{runnerId}/logs | Search runner logs with server-side filtering, full-text search, and sort |
| [**cliRunnerControllerStartRunner**](RunnersApi.md#clirunnercontrollerstartrunner) | **POST** /sources/{sourceId}/run | Start CLI runner for source |
| [**cliRunnerControllerStopRunner**](RunnersApi.md#clirunnercontrollerstoprunner) | **PATCH** /runners/{runnerId}/stop | Stop running CLI process |
| [**cliRunnerControllerUpdateRunnerAssetStatuses**](RunnersApi.md#clirunnercontrollerupdaterunnerassetstatuses) | **PATCH** /runners/{runnerId}/assets/status | Update processing status of runner assets |
| [**cliRunnerControllerUpdateRunnerStatus**](RunnersApi.md#clirunnercontrollerupdaterunnerstatusoperation) | **PATCH** /runners/{runnerId}/status | Update runner status |
| [**searchRunnersControllerSearchRunnerAssets**](RunnersApi.md#searchrunnerscontrollersearchrunnerassets) | **POST** /search/runner-assets | Search runner assets |
| [**searchRunnersControllerSearchRunners**](RunnersApi.md#searchrunnerscontrollersearchrunners) | **POST** /search/runners | Search runners |
| [**searchRunnersControllerSearchRunnersCharts**](RunnersApi.md#searchrunnerscontrollersearchrunnerscharts) | **POST** /search/runners/charts | Runners charts overview |



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
    // 'PENDING' | 'RUNNING' | 'COMPLETED' | 'WARNING' | 'ERROR' (optional)
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
| **status** | `PENDING`, `RUNNING`, `COMPLETED`, `WARNING`, `ERROR` |  | [Optional] [Defaults to `undefined`] [Enum: PENDING, RUNNING, COMPLETED, WARNING, ERROR] |
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
    // 'PENDING' | 'RUNNING' | 'COMPLETED' | 'WARNING' | 'ERROR' (optional)
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
| **status** | `PENDING`, `RUNNING`, `COMPLETED`, `WARNING`, `ERROR` |  | [Optional] [Defaults to `undefined`] [Enum: PENDING, RUNNING, COMPLETED, WARNING, ERROR] |
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

Stop running CLI process

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

