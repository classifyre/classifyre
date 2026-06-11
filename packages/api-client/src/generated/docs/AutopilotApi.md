# AutopilotApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**autopilotControllerGetRun**](AutopilotApi.md#autopilotcontrollergetrun) | **GET** /autopilot/runs/{id} | Get one autopilot run with all decisions and rationales |
| [**autopilotControllerListRuns**](AutopilotApi.md#autopilotcontrollerlistruns) | **GET** /autopilot/runs | List autopilot agent runs (newest first) |



## autopilotControllerGetRun

> AgentRunDetailDto autopilotControllerGetRun(id)

Get one autopilot run with all decisions and rationales

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { AutopilotControllerGetRunRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  const body = {
    // string
    id: id_example,
  } satisfies AutopilotControllerGetRunRequest;

  try {
    const data = await api.autopilotControllerGetRun(body);
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

[**AgentRunDetailDto**](AgentRunDetailDto.md)

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


## autopilotControllerListRuns

> AgentRunListResponseDto autopilotControllerListRuns(agentKind, status, skip, limit)

List autopilot agent runs (newest first)

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { AutopilotControllerListRunsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  const body = {
    // 'INQUIRY' | 'CASE' (optional)
    agentKind: agentKind_example,
    // 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED' (optional)
    status: status_example,
    // number (optional)
    skip: 8.14,
    // number (optional)
    limit: 8.14,
  } satisfies AutopilotControllerListRunsRequest;

  try {
    const data = await api.autopilotControllerListRuns(body);
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
| **agentKind** | `INQUIRY`, `CASE` |  | [Optional] [Defaults to `undefined`] [Enum: INQUIRY, CASE] |
| **status** | `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `SKIPPED` |  | [Optional] [Defaults to `undefined`] [Enum: PENDING, RUNNING, COMPLETED, FAILED, SKIPPED] |
| **skip** | `number` |  | [Optional] [Defaults to `0`] |
| **limit** | `number` |  | [Optional] [Defaults to `50`] |

### Return type

[**AgentRunListResponseDto**](AgentRunListResponseDto.md)

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

