# AutopilotApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**autopilotControllerCancelRun**](AutopilotApi.md#autopilotcontrollercancelrun) | **POST** /autopilot/runs/{id}/cancel | Stop a pending/running agent run (it aborts before its next step) |
| [**autopilotControllerCreateMemory**](AutopilotApi.md#autopilotcontrollercreatememory) | **POST** /autopilot/memory | Add (or overwrite) a memory entry to steer the agent |
| [**autopilotControllerDeleteMemory**](AutopilotApi.md#autopilotcontrollerdeletememory) | **DELETE** /autopilot/memory/{id} | Delete a memory entry the agent learned |
| [**autopilotControllerGetAgents**](AutopilotApi.md#autopilotcontrollergetagents) | **GET** /autopilot/agents | Per-agent configuration: enable flag, goal, iteration budget and assigned built-in/MCP tools |
| [**autopilotControllerGetRun**](AutopilotApi.md#autopilotcontrollergetrun) | **GET** /autopilot/runs/{id} | Get one autopilot run with all decisions and rationales |
| [**autopilotControllerGetStats**](AutopilotApi.md#autopilotcontrollergetstats) | **GET** /autopilot/stats | Mission-control counters (runs, decisions, memory, brief version) |
| [**autopilotControllerGetSystemBrief**](AutopilotApi.md#autopilotcontrollergetsystembrief) | **GET** /autopilot/system-brief | The living system brief the autopilot maintains and injects |
| [**autopilotControllerGetTools**](AutopilotApi.md#autopilotcontrollergettools) | **GET** /autopilot/tools | The harness capability map — every registered tool (read/mutate, domain) and the missions that use them |
| [**autopilotControllerGetUsage**](AutopilotApi.md#autopilotcontrollergetusage) | **GET** /autopilot/usage | LLM token/cost usage per day and agent (for the harness usage charts) — filter by agent kind and time range |
| [**autopilotControllerListActivity**](AutopilotApi.md#autopilotcontrollerlistactivity) | **GET** /autopilot/activity | Cross-run activity feed (the business timeline) — server-side filter by kind, action, outcome, entity, text and time |
| [**autopilotControllerListLogs**](AutopilotApi.md#autopilotcontrollerlistlogs) | **GET** /autopilot/runs/{id}/logs | Execution log of a run — filter by channel (BUSINESS narrative vs TECHNICAL mechanics/raw model output) |
| [**autopilotControllerListMemory**](AutopilotApi.md#autopilotcontrollerlistmemory) | **GET** /autopilot/memory | List the agent memory (glossary, precedents, topic map) |
| [**autopilotControllerListRuns**](AutopilotApi.md#autopilotcontrollerlistruns) | **GET** /autopilot/runs | List autopilot agent runs (newest first) |
| [**autopilotControllerRerunRun**](AutopilotApi.md#autopilotcontrollerrerunrun) | **POST** /autopilot/runs/{id}/rerun | Re-execute one specific agent run from scratch under its original cycle identity |
| [**autopilotControllerTrigger**](AutopilotApi.md#autopilotcontrollertrigger) | **POST** /autopilot/trigger | Manually trigger an autopilot cycle over existing data, with an optional steering instruction |
| [**autopilotControllerTriggerDream**](AutopilotApi.md#autopilotcontrollertriggerdream) | **POST** /autopilot/dream | Trigger a dream cycle now (memory consolidation — dedupe, prune noise, distill notes) |
| [**autopilotControllerUpdateAgent**](AutopilotApi.md#autopilotcontrollerupdateagent) | **PATCH** /autopilot/agents/{kind} | Retune one agent — toggle it, edit its goal/iterations, or reassign its built-in tools |
| [**autopilotControllerUpdateMemory**](AutopilotApi.md#autopilotcontrollerupdatememory) | **PATCH** /autopilot/memory/{id} | Edit a memory entry (content, tags, weight) |
| [**autopilotControllerUpdateSystemBrief**](AutopilotApi.md#autopilotcontrollerupdatesystembrief) | **PUT** /autopilot/system-brief | Create or rewrite the system-brief narrative |
| [**mcpServersControllerCreate**](AutopilotApi.md#mcpserverscontrollercreate) | **POST** /autopilot/mcp-servers | Add an external MCP server |
| [**mcpServersControllerList**](AutopilotApi.md#mcpserverscontrollerlist) | **GET** /autopilot/mcp-servers | List configured external MCP servers |
| [**mcpServersControllerRefresh**](AutopilotApi.md#mcpserverscontrollerrefresh) | **POST** /autopilot/mcp-servers/refresh | Reconnect all enabled servers and rediscover tools |
| [**mcpServersControllerRemove**](AutopilotApi.md#mcpserverscontrollerremove) | **DELETE** /autopilot/mcp-servers/{id} | Remove an MCP server |
| [**mcpServersControllerTest**](AutopilotApi.md#mcpserverscontrollertest) | **POST** /autopilot/mcp-servers/{id}/test | Probe a server: connect and list its tools |
| [**mcpServersControllerUpdate**](AutopilotApi.md#mcpserverscontrollerupdate) | **PATCH** /autopilot/mcp-servers/{id} | Update an MCP server |



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


## autopilotControllerGetAgents

> AgentConfigListResponseDto autopilotControllerGetAgents()

Per-agent configuration: enable flag, goal, iteration budget and assigned built-in/MCP tools

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { AutopilotControllerGetAgentsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  try {
    const data = await api.autopilotControllerGetAgents();
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

[**AgentConfigListResponseDto**](AgentConfigListResponseDto.md)

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


## autopilotControllerGetStats

> AutopilotStatsDto autopilotControllerGetStats()

Mission-control counters (runs, decisions, memory, brief version)

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { AutopilotControllerGetStatsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  try {
    const data = await api.autopilotControllerGetStats();
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

[**AutopilotStatsDto**](AutopilotStatsDto.md)

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


## autopilotControllerGetSystemBrief

> AgentSystemBriefDto autopilotControllerGetSystemBrief()

The living system brief the autopilot maintains and injects

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { AutopilotControllerGetSystemBriefRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  try {
    const data = await api.autopilotControllerGetSystemBrief();
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

[**AgentSystemBriefDto**](AgentSystemBriefDto.md)

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


## autopilotControllerGetTools

> HarnessToolsResponseDto autopilotControllerGetTools()

The harness capability map — every registered tool (read/mutate, domain) and the missions that use them

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { AutopilotControllerGetToolsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  try {
    const data = await api.autopilotControllerGetTools();
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

[**HarnessToolsResponseDto**](HarnessToolsResponseDto.md)

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


## autopilotControllerGetUsage

> AgentUsageResponseDto autopilotControllerGetUsage(agentKind, since, until)

LLM token/cost usage per day and agent (for the harness usage charts) — filter by agent kind and time range

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { AutopilotControllerGetUsageRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  const body = {
    // 'INQUIRY' | 'CASE' | 'DREAM' | 'DUPLICATES' | 'CONFIG' | 'DETECTOR_AUTHOR' | 'ESCALATION' | 'CHAT' (optional)
    agentKind: agentKind_example,
    // string | ISO lower bound for run creation (default: 30 days ago) (optional)
    since: since_example,
    // string | ISO upper bound for run creation (optional)
    until: until_example,
  } satisfies AutopilotControllerGetUsageRequest;

  try {
    const data = await api.autopilotControllerGetUsage(body);
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
| **agentKind** | `INQUIRY`, `CASE`, `DREAM`, `DUPLICATES`, `CONFIG`, `DETECTOR_AUTHOR`, `ESCALATION`, `CHAT` |  | [Optional] [Defaults to `undefined`] [Enum: INQUIRY, CASE, DREAM, DUPLICATES, CONFIG, DETECTOR_AUTHOR, ESCALATION, CHAT] |
| **since** | `string` | ISO lower bound for run creation (default: 30 days ago) | [Optional] [Defaults to `undefined`] |
| **until** | `string` | ISO upper bound for run creation | [Optional] [Defaults to `undefined`] |

### Return type

[**AgentUsageResponseDto**](AgentUsageResponseDto.md)

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


## autopilotControllerListActivity

> AgentActivityListResponseDto autopilotControllerListActivity(agentKind, action, outcome, entityType, search, since, until, skip, limit)

Cross-run activity feed (the business timeline) — server-side filter by kind, action, outcome, entity, text and time

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { AutopilotControllerListActivityRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  const body = {
    // 'INQUIRY' | 'CASE' | 'DREAM' | 'DUPLICATES' | 'CONFIG' | 'DETECTOR_AUTHOR' | 'ESCALATION' | 'CHAT' (optional)
    agentKind: agentKind_example,
    // 'CREATE_INQUIRY' | 'UPDATE_INQUIRY' | 'ENRICH_INQUIRY_MATCHERS' | 'SIGNAL_CASE_READY' | 'CREATE_CASE' | 'UPDATE_CASE' | 'ADD_HYPOTHESIS' | 'UPDATE_HYPOTHESIS' | 'ADD_EVIDENCE' | 'ATTACH_FINDINGS' | 'ADD_NOTE' | 'ADD_THREAD_ENTRY' | 'CREATE_EDGE' | 'REMOVE_EDGE' | 'LINK_SUPPORT' | 'CHANGE_STATUS' | 'LINK_INQUIRY' | 'CONSOLIDATE_MEMORY' | 'LINK_DUPLICATE' | 'UPDATE_CLUSTER' | 'TOOL_CALL' | 'TUNE_SOURCE' | 'CREATE_DETECTOR' | 'TRAIN_DETECTOR' | 'UPDATE_DETECTOR' | 'DELETE_DETECTOR' | 'TRIGGER_SCAN' | 'UPDATE_SYSTEM_BRIEF' | 'RECOMPUTE_CORRELATION' | 'TUNE_CORRELATION' | 'NOTIFY_OPERATOR' | 'NO_ACTION' (optional)
    action: action_example,
    // 'APPLIED' | 'SKIPPED_OBSERVE_ONLY' | 'FAILED' (optional)
    outcome: outcome_example,
    // string | inquiry | case | source | detector | memory | system | asset (optional)
    entityType: entityType_example,
    // string | Substring search over the rationale (optional)
    search: search_example,
    // string | ISO time lower bound (optional)
    since: since_example,
    // string | ISO time upper bound (optional)
    until: until_example,
    // number (optional)
    skip: 8.14,
    // number (optional)
    limit: 8.14,
  } satisfies AutopilotControllerListActivityRequest;

  try {
    const data = await api.autopilotControllerListActivity(body);
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
| **agentKind** | `INQUIRY`, `CASE`, `DREAM`, `DUPLICATES`, `CONFIG`, `DETECTOR_AUTHOR`, `ESCALATION`, `CHAT` |  | [Optional] [Defaults to `undefined`] [Enum: INQUIRY, CASE, DREAM, DUPLICATES, CONFIG, DETECTOR_AUTHOR, ESCALATION, CHAT] |
| **action** | `CREATE_INQUIRY`, `UPDATE_INQUIRY`, `ENRICH_INQUIRY_MATCHERS`, `SIGNAL_CASE_READY`, `CREATE_CASE`, `UPDATE_CASE`, `ADD_HYPOTHESIS`, `UPDATE_HYPOTHESIS`, `ADD_EVIDENCE`, `ATTACH_FINDINGS`, `ADD_NOTE`, `ADD_THREAD_ENTRY`, `CREATE_EDGE`, `REMOVE_EDGE`, `LINK_SUPPORT`, `CHANGE_STATUS`, `LINK_INQUIRY`, `CONSOLIDATE_MEMORY`, `LINK_DUPLICATE`, `UPDATE_CLUSTER`, `TOOL_CALL`, `TUNE_SOURCE`, `CREATE_DETECTOR`, `TRAIN_DETECTOR`, `UPDATE_DETECTOR`, `DELETE_DETECTOR`, `TRIGGER_SCAN`, `UPDATE_SYSTEM_BRIEF`, `RECOMPUTE_CORRELATION`, `TUNE_CORRELATION`, `NOTIFY_OPERATOR`, `NO_ACTION` |  | [Optional] [Defaults to `undefined`] [Enum: CREATE_INQUIRY, UPDATE_INQUIRY, ENRICH_INQUIRY_MATCHERS, SIGNAL_CASE_READY, CREATE_CASE, UPDATE_CASE, ADD_HYPOTHESIS, UPDATE_HYPOTHESIS, ADD_EVIDENCE, ATTACH_FINDINGS, ADD_NOTE, ADD_THREAD_ENTRY, CREATE_EDGE, REMOVE_EDGE, LINK_SUPPORT, CHANGE_STATUS, LINK_INQUIRY, CONSOLIDATE_MEMORY, LINK_DUPLICATE, UPDATE_CLUSTER, TOOL_CALL, TUNE_SOURCE, CREATE_DETECTOR, TRAIN_DETECTOR, UPDATE_DETECTOR, DELETE_DETECTOR, TRIGGER_SCAN, UPDATE_SYSTEM_BRIEF, RECOMPUTE_CORRELATION, TUNE_CORRELATION, NOTIFY_OPERATOR, NO_ACTION] |
| **outcome** | `APPLIED`, `SKIPPED_OBSERVE_ONLY`, `FAILED` |  | [Optional] [Defaults to `undefined`] [Enum: APPLIED, SKIPPED_OBSERVE_ONLY, FAILED] |
| **entityType** | `string` | inquiry | case | source | detector | memory | system | asset | [Optional] [Defaults to `undefined`] |
| **search** | `string` | Substring search over the rationale | [Optional] [Defaults to `undefined`] |
| **since** | `string` | ISO time lower bound | [Optional] [Defaults to `undefined`] |
| **until** | `string` | ISO time upper bound | [Optional] [Defaults to `undefined`] |
| **skip** | `number` |  | [Optional] [Defaults to `0`] |
| **limit** | `number` |  | [Optional] [Defaults to `50`] |

### Return type

[**AgentActivityListResponseDto**](AgentActivityListResponseDto.md)

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

> AgentLogListResponseDto autopilotControllerListLogs(id, channel, level, search)

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
    // 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' (optional)
    level: level_example,
    // string | Substring search over the message (optional)
    search: search_example,
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
| **level** | `DEBUG`, `INFO`, `WARN`, `ERROR` |  | [Optional] [Defaults to `undefined`] [Enum: DEBUG, INFO, WARN, ERROR] |
| **search** | `string` | Substring search over the message | [Optional] [Defaults to `undefined`] |

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
    // 'GLOSSARY' | 'DECISION_PRECEDENT' | 'ENTITY_MAP' | 'SOURCE_PROFILE' | 'DETECTOR_INSIGHT' | 'OPERATOR_DIRECTIVE' (optional)
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
| **kind** | `GLOSSARY`, `DECISION_PRECEDENT`, `ENTITY_MAP`, `SOURCE_PROFILE`, `DETECTOR_INSIGHT`, `OPERATOR_DIRECTIVE` |  | [Optional] [Defaults to `undefined`] [Enum: GLOSSARY, DECISION_PRECEDENT, ENTITY_MAP, SOURCE_PROFILE, DETECTOR_INSIGHT, OPERATOR_DIRECTIVE] |
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

> AgentRunListResponseDto autopilotControllerListRuns(agentKind, caseId, sourceId, status, trigger, search, since, until, skip, limit)

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
    // 'INQUIRY' | 'CASE' | 'DREAM' | 'DUPLICATES' | 'CONFIG' | 'DETECTOR_AUTHOR' | 'ESCALATION' | 'CHAT' (optional)
    agentKind: agentKind_example,
    // string | Only runs focused on this case (optional)
    caseId: caseId_example,
    // string | Only runs for this source (optional)
    sourceId: sourceId_example,
    // 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED' | 'CANCELLED' (optional)
    status: status_example,
    // string | Trigger origin: scan_completed | manual | schedule (optional)
    trigger: trigger_example,
    // string | Substring search over summary, instruction and error (optional)
    search: search_example,
    // string | Only runs created at/after this ISO time (optional)
    since: since_example,
    // string | Only runs created at/before this ISO time (optional)
    until: until_example,
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
| **agentKind** | `INQUIRY`, `CASE`, `DREAM`, `DUPLICATES`, `CONFIG`, `DETECTOR_AUTHOR`, `ESCALATION`, `CHAT` |  | [Optional] [Defaults to `undefined`] [Enum: INQUIRY, CASE, DREAM, DUPLICATES, CONFIG, DETECTOR_AUTHOR, ESCALATION, CHAT] |
| **caseId** | `string` | Only runs focused on this case | [Optional] [Defaults to `undefined`] |
| **sourceId** | `string` | Only runs for this source | [Optional] [Defaults to `undefined`] |
| **status** | `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `SKIPPED`, `CANCELLED` |  | [Optional] [Defaults to `undefined`] [Enum: PENDING, RUNNING, COMPLETED, FAILED, SKIPPED, CANCELLED] |
| **trigger** | `string` | Trigger origin: scan_completed | manual | schedule | [Optional] [Defaults to `undefined`] |
| **search** | `string` | Substring search over summary, instruction and error | [Optional] [Defaults to `undefined`] |
| **since** | `string` | Only runs created at/after this ISO time | [Optional] [Defaults to `undefined`] |
| **until** | `string` | Only runs created at/before this ISO time | [Optional] [Defaults to `undefined`] |
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


## autopilotControllerUpdateAgent

> AgentConfigDto autopilotControllerUpdateAgent(kind, updateAgentConfigDto)

Retune one agent — toggle it, edit its goal/iterations, or reassign its built-in tools

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { AutopilotControllerUpdateAgentRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  const body = {
    // 'INQUIRY' | 'CASE' | 'DREAM' | 'DUPLICATES' | 'CONFIG' | 'DETECTOR_AUTHOR' | 'ESCALATION' | 'CHAT'
    kind: kind_example,
    // UpdateAgentConfigDto
    updateAgentConfigDto: ...,
  } satisfies AutopilotControllerUpdateAgentRequest;

  try {
    const data = await api.autopilotControllerUpdateAgent(body);
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
| **kind** | `INQUIRY`, `CASE`, `DREAM`, `DUPLICATES`, `CONFIG`, `DETECTOR_AUTHOR`, `ESCALATION`, `CHAT` |  | [Defaults to `undefined`] [Enum: INQUIRY, CASE, DREAM, DUPLICATES, CONFIG, DETECTOR_AUTHOR, ESCALATION, CHAT] |
| **updateAgentConfigDto** | [UpdateAgentConfigDto](UpdateAgentConfigDto.md) |  | |

### Return type

[**AgentConfigDto**](AgentConfigDto.md)

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


## autopilotControllerUpdateSystemBrief

> AgentSystemBriefDto autopilotControllerUpdateSystemBrief(updateSystemBriefDto)

Create or rewrite the system-brief narrative

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { AutopilotControllerUpdateSystemBriefRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  const body = {
    // UpdateSystemBriefDto
    updateSystemBriefDto: ...,
  } satisfies AutopilotControllerUpdateSystemBriefRequest;

  try {
    const data = await api.autopilotControllerUpdateSystemBrief(body);
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
| **updateSystemBriefDto** | [UpdateSystemBriefDto](UpdateSystemBriefDto.md) |  | |

### Return type

[**AgentSystemBriefDto**](AgentSystemBriefDto.md)

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


## mcpServersControllerCreate

> McpServerResponseDto mcpServersControllerCreate(createMcpServerDto)

Add an external MCP server

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { McpServersControllerCreateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  const body = {
    // CreateMcpServerDto
    createMcpServerDto: ...,
  } satisfies McpServersControllerCreateRequest;

  try {
    const data = await api.mcpServersControllerCreate(body);
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
| **createMcpServerDto** | [CreateMcpServerDto](CreateMcpServerDto.md) |  | |

### Return type

[**McpServerResponseDto**](McpServerResponseDto.md)

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


## mcpServersControllerList

> Array&lt;McpServerResponseDto&gt; mcpServersControllerList()

List configured external MCP servers

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { McpServersControllerListRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  try {
    const data = await api.mcpServersControllerList();
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

[**Array&lt;McpServerResponseDto&gt;**](McpServerResponseDto.md)

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


## mcpServersControllerRefresh

> Array&lt;McpServerResponseDto&gt; mcpServersControllerRefresh()

Reconnect all enabled servers and rediscover tools

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { McpServersControllerRefreshRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  try {
    const data = await api.mcpServersControllerRefresh();
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

[**Array&lt;McpServerResponseDto&gt;**](McpServerResponseDto.md)

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


## mcpServersControllerRemove

> mcpServersControllerRemove(id)

Remove an MCP server

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { McpServersControllerRemoveRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  const body = {
    // string
    id: id_example,
  } satisfies McpServersControllerRemoveRequest;

  try {
    const data = await api.mcpServersControllerRemove(body);
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


## mcpServersControllerTest

> McpServerTestResultDto mcpServersControllerTest(id)

Probe a server: connect and list its tools

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { McpServersControllerTestRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  const body = {
    // string
    id: id_example,
  } satisfies McpServersControllerTestRequest;

  try {
    const data = await api.mcpServersControllerTest(body);
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

[**McpServerTestResultDto**](McpServerTestResultDto.md)

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


## mcpServersControllerUpdate

> McpServerResponseDto mcpServersControllerUpdate(id, updateMcpServerDto)

Update an MCP server

### Example

```ts
import {
  Configuration,
  AutopilotApi,
} from '@workspace/api-client';
import type { McpServersControllerUpdateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AutopilotApi();

  const body = {
    // string
    id: id_example,
    // UpdateMcpServerDto
    updateMcpServerDto: ...,
  } satisfies McpServersControllerUpdateRequest;

  try {
    const data = await api.mcpServersControllerUpdate(body);
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
| **updateMcpServerDto** | [UpdateMcpServerDto](UpdateMcpServerDto.md) |  | |

### Return type

[**McpServerResponseDto**](McpServerResponseDto.md)

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

