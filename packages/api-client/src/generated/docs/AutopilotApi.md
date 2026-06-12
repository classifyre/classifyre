# AutopilotApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**autopilotControllerCancelRun**](AutopilotApi.md#autopilotcontrollercancelrun) | **POST** /autopilot/runs/{id}/cancel | Stop a pending/running agent run (it aborts before its next step) |
| [**autopilotControllerCreateMemory**](AutopilotApi.md#autopilotcontrollercreatememory) | **POST** /autopilot/memory | Add (or overwrite) a memory entry to steer the agent |
| [**autopilotControllerDeleteMemory**](AutopilotApi.md#autopilotcontrollerdeletememory) | **DELETE** /autopilot/memory/{id} | Delete a memory entry the agent learned |
| [**autopilotControllerGetRun**](AutopilotApi.md#autopilotcontrollergetrun) | **GET** /autopilot/runs/{id} | Get one autopilot run with all decisions and rationales |
| [**autopilotControllerListLogs**](AutopilotApi.md#autopilotcontrollerlistlogs) | **GET** /autopilot/runs/{id}/logs | Execution log of a run — filter by channel (BUSINESS narrative vs TECHNICAL mechanics/raw model output) |
| [**autopilotControllerListMemory**](AutopilotApi.md#autopilotcontrollerlistmemory) | **GET** /autopilot/memory | List the agent memory (glossary, precedents, topic map) |
| [**autopilotControllerListRuns**](AutopilotApi.md#autopilotcontrollerlistruns) | **GET** /autopilot/runs | List autopilot agent runs (newest first) |
| [**autopilotControllerRerunRun**](AutopilotApi.md#autopilotcontrollerrerunrun) | **POST** /autopilot/runs/{id}/rerun | Re-execute one specific agent run from scratch under its original cycle identity |
| [**autopilotControllerTrigger**](AutopilotApi.md#autopilotcontrollertrigger) | **POST** /autopilot/trigger | Manually trigger an autopilot cycle over existing data, with an optional steering instruction |
| [**autopilotControllerTriggerDream**](AutopilotApi.md#autopilotcontrollertriggerdream) | **POST** /autopilot/dream | Trigger a dream cycle now (memory consolidation — dedupe, prune noise, distill notes) |
| [**autopilotControllerUpdateMemory**](AutopilotApi.md#autopilotcontrollerupdatememory) | **PATCH** /autopilot/memory/{id} | Edit a memory entry (content, tags, weight) |



## autopilotControllerCancelRun

> AgentRunDto autopilotControllerCancelRun(id)

Stop a pending/running agent run (it aborts before its next step)

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { AutopilotControllerCancelRunRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  const body = {
    // string
    id: id_example,
  } satisfies AutopilotControllerCancelRunRequest;

  try {
    const data = await api.autopilotControllerCancelRun(body);
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

[**AgentRunDto**](AgentRunDto.md)

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


## autopilotControllerCreateMemory

> AgentMemoryDto autopilotControllerCreateMemory(createAgentMemoryDto)

Add (or overwrite) a memory entry to steer the agent

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { AutopilotControllerCreateMemoryRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  const body = {
    // CreateAgentMemoryDto
    createAgentMemoryDto: ...,
  } satisfies AutopilotControllerCreateMemoryRequest;

  try {
    const data = await api.autopilotControllerCreateMemory(body);
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
| **createAgentMemoryDto** | [CreateAgentMemoryDto](CreateAgentMemoryDto.md) |  | |

### Return type

[**AgentMemoryDto**](AgentMemoryDto.md)

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


## autopilotControllerDeleteMemory

> autopilotControllerDeleteMemory(id)

Delete a memory entry the agent learned

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { AutopilotControllerDeleteMemoryRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  const body = {
    // string
    id: id_example,
  } satisfies AutopilotControllerDeleteMemoryRequest;

  try {
    const data = await api.autopilotControllerDeleteMemory(body);
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


## autopilotControllerListLogs

> AgentLogListResponseDto autopilotControllerListLogs(id, channel)

Execution log of a run — filter by channel (BUSINESS narrative vs TECHNICAL mechanics/raw model output)

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { AutopilotControllerListLogsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  const body = {
    // string
    id: id_example,
    // 'TECHNICAL' | 'BUSINESS' | BUSINESS = analyst narrative, TECHNICAL = mechanics/raw model I/O (optional)
    channel: channel_example,
  } satisfies AutopilotControllerListLogsRequest;

  try {
    const data = await api.autopilotControllerListLogs(body);
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
| **channel** | `TECHNICAL`, `BUSINESS` | BUSINESS &#x3D; analyst narrative, TECHNICAL &#x3D; mechanics/raw model I/O | [Optional] [Defaults to `undefined`] [Enum: TECHNICAL, BUSINESS] |

### Return type

[**AgentLogListResponseDto**](AgentLogListResponseDto.md)

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


## autopilotControllerListMemory

> AgentMemoryListResponseDto autopilotControllerListMemory(kind, search, skip, limit)

List the agent memory (glossary, precedents, topic map)

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { AutopilotControllerListMemoryRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  const body = {
    // 'GLOSSARY' | 'DECISION_PRECEDENT' | 'TOPIC_INQUIRY_MAP' (optional)
    kind: kind_example,
    // string | Substring search over key and content (optional)
    search: search_example,
    // number (optional)
    skip: 8.14,
    // number (optional)
    limit: 8.14,
  } satisfies AutopilotControllerListMemoryRequest;

  try {
    const data = await api.autopilotControllerListMemory(body);
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
| **kind** | `GLOSSARY`, `DECISION_PRECEDENT`, `TOPIC_INQUIRY_MAP` |  | [Optional] [Defaults to `undefined`] [Enum: GLOSSARY, DECISION_PRECEDENT, TOPIC_INQUIRY_MAP] |
| **search** | `string` | Substring search over key and content | [Optional] [Defaults to `undefined`] |
| **skip** | `number` |  | [Optional] [Defaults to `0`] |
| **limit** | `number` |  | [Optional] [Defaults to `50`] |

### Return type

[**AgentMemoryListResponseDto**](AgentMemoryListResponseDto.md)

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
    // 'INQUIRY' | 'CASE' | 'DREAM' (optional)
    agentKind: agentKind_example,
    // 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED' | 'CANCELLED' (optional)
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
| **agentKind** | `INQUIRY`, `CASE`, `DREAM` |  | [Optional] [Defaults to `undefined`] [Enum: INQUIRY, CASE, DREAM] |
| **status** | `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `SKIPPED`, `CANCELLED` |  | [Optional] [Defaults to `undefined`] [Enum: PENDING, RUNNING, COMPLETED, FAILED, SKIPPED, CANCELLED] |
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


## autopilotControllerRerunRun

> TriggerAutopilotResponseDto autopilotControllerRerunRun(id)

Re-execute one specific agent run from scratch under its original cycle identity

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { AutopilotControllerRerunRunRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  const body = {
    // string
    id: id_example,
  } satisfies AutopilotControllerRerunRunRequest;

  try {
    const data = await api.autopilotControllerRerunRun(body);
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

[**TriggerAutopilotResponseDto**](TriggerAutopilotResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **202** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## autopilotControllerTrigger

> TriggerAutopilotResponseDto autopilotControllerTrigger(triggerAutopilotDto)

Manually trigger an autopilot cycle over existing data, with an optional steering instruction

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { AutopilotControllerTriggerRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  const body = {
    // TriggerAutopilotDto
    triggerAutopilotDto: ...,
  } satisfies AutopilotControllerTriggerRequest;

  try {
    const data = await api.autopilotControllerTrigger(body);
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
| **triggerAutopilotDto** | [TriggerAutopilotDto](TriggerAutopilotDto.md) |  | |

### Return type

[**TriggerAutopilotResponseDto**](TriggerAutopilotResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **202** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## autopilotControllerTriggerDream

> TriggerAutopilotResponseDto autopilotControllerTriggerDream()

Trigger a dream cycle now (memory consolidation — dedupe, prune noise, distill notes)

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { AutopilotControllerTriggerDreamRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  try {
    const data = await api.autopilotControllerTriggerDream();
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

[**TriggerAutopilotResponseDto**](TriggerAutopilotResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **202** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## autopilotControllerUpdateMemory

> AgentMemoryDto autopilotControllerUpdateMemory(id, updateAgentMemoryDto)

Edit a memory entry (content, tags, weight)

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { AutopilotControllerUpdateMemoryRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  const body = {
    // string
    id: id_example,
    // UpdateAgentMemoryDto
    updateAgentMemoryDto: ...,
  } satisfies AutopilotControllerUpdateMemoryRequest;

  try {
    const data = await api.autopilotControllerUpdateMemory(body);
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
| **updateAgentMemoryDto** | [UpdateAgentMemoryDto](UpdateAgentMemoryDto.md) |  | |

### Return type

[**AgentMemoryDto**](AgentMemoryDto.md)

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

