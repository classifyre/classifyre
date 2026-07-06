# ChatBotsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**chatBotsControllerCreate**](ChatBotsApi.md#chatbotscontrollercreate) | **POST** /instance-settings/chat/bots | Create a chat bot |
| [**chatBotsControllerDiagnostics**](ChatBotsApi.md#chatbotscontrollerdiagnostics) | **GET** /instance-settings/chat/bots/{id}/diagnostics | Chat bot diagnostics |
| [**chatBotsControllerList**](ChatBotsApi.md#chatbotscontrollerlist) | **GET** /instance-settings/chat/bots | List chat bots |
| [**chatBotsControllerRemove**](ChatBotsApi.md#chatbotscontrollerremove) | **DELETE** /instance-settings/chat/bots/{id} | Delete a chat bot |
| [**chatBotsControllerSimulate**](ChatBotsApi.md#chatbotscontrollersimulate) | **POST** /instance-settings/chat/bots/{id}/simulate | Send a test message to a chat bot |
| [**chatBotsControllerTest**](ChatBotsApi.md#chatbotscontrollertest) | **POST** /instance-settings/chat/bots/{id}/test | Test chat bot connection |
| [**chatBotsControllerUpdate**](ChatBotsApi.md#chatbotscontrollerupdate) | **PATCH** /instance-settings/chat/bots/{id} | Update a chat bot |



## chatBotsControllerCreate

> ChatBotResponseDto chatBotsControllerCreate(createChatBotDto)

Create a chat bot

Stores the bot credentials encrypted and (when enabled) connects it: Telegram via long-polling, Slack via Socket Mode.

### Example

```ts
import {
  Configuration,
  ChatBotsApi,
} from '@workspace/api-client';
import type { ChatBotsControllerCreateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new ChatBotsApi();

  const body = {
    // CreateChatBotDto
    createChatBotDto: ...,
  } satisfies ChatBotsControllerCreateRequest;

  try {
    const data = await api.chatBotsControllerCreate(body);
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
| **createChatBotDto** | [CreateChatBotDto](CreateChatBotDto.md) |  | |

### Return type

[**ChatBotResponseDto**](ChatBotResponseDto.md)

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


## chatBotsControllerDiagnostics

> ChatBotDiagnosticsDto chatBotsControllerDiagnostics(id)

Chat bot diagnostics

Runtime connector telemetry: whether the connector runs, message/reply counters and the recent in-memory activity log (newest first).

### Example

```ts
import {
  Configuration,
  ChatBotsApi,
} from '@workspace/api-client';
import type { ChatBotsControllerDiagnosticsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new ChatBotsApi();

  const body = {
    // string
    id: id_example,
  } satisfies ChatBotsControllerDiagnosticsRequest;

  try {
    const data = await api.chatBotsControllerDiagnostics(body);
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

[**ChatBotDiagnosticsDto**](ChatBotDiagnosticsDto.md)

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


## chatBotsControllerList

> Array&lt;ChatBotResponseDto&gt; chatBotsControllerList()

List chat bots

Returns every configured Telegram/Slack bot with masked token previews, permissions and connection status.

### Example

```ts
import {
  Configuration,
  ChatBotsApi,
} from '@workspace/api-client';
import type { ChatBotsControllerListRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new ChatBotsApi();

  try {
    const data = await api.chatBotsControllerList();
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

[**Array&lt;ChatBotResponseDto&gt;**](ChatBotResponseDto.md)

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


## chatBotsControllerRemove

> chatBotsControllerRemove(id)

Delete a chat bot

Disconnects the bot and deletes it with all its sessions and messages.

### Example

```ts
import {
  Configuration,
  ChatBotsApi,
} from '@workspace/api-client';
import type { ChatBotsControllerRemoveRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new ChatBotsApi();

  const body = {
    // string
    id: id_example,
  } satisfies ChatBotsControllerRemoveRequest;

  try {
    const data = await api.chatBotsControllerRemove(body);
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
| **204** | Deleted. |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## chatBotsControllerSimulate

> ChatBotSimulateResultDto chatBotsControllerSimulate(id, chatBotSimulateDto)

Send a test message to a chat bot

Runs one real agent turn (tools, audit, history in a dedicated simulator session) without going through Telegram/Slack, and returns the reply. Slow — the turn runs synchronously.

### Example

```ts
import {
  Configuration,
  ChatBotsApi,
} from '@workspace/api-client';
import type { ChatBotsControllerSimulateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new ChatBotsApi();

  const body = {
    // string
    id: id_example,
    // ChatBotSimulateDto
    chatBotSimulateDto: ...,
  } satisfies ChatBotsControllerSimulateRequest;

  try {
    const data = await api.chatBotsControllerSimulate(body);
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
| **chatBotSimulateDto** | [ChatBotSimulateDto](ChatBotSimulateDto.md) |  | |

### Return type

[**ChatBotSimulateResultDto**](ChatBotSimulateResultDto.md)

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


## chatBotsControllerTest

> ChatBotTestResultDto chatBotsControllerTest(id)

Test chat bot connection

Runs live checks with the stored credentials: Telegram getMe + webhook conflict detection, Slack auth.test (bot token) + apps.connections.open (app token).

### Example

```ts
import {
  Configuration,
  ChatBotsApi,
} from '@workspace/api-client';
import type { ChatBotsControllerTestRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new ChatBotsApi();

  const body = {
    // string
    id: id_example,
  } satisfies ChatBotsControllerTestRequest;

  try {
    const data = await api.chatBotsControllerTest(body);
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

[**ChatBotTestResultDto**](ChatBotTestResultDto.md)

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


## chatBotsControllerUpdate

> ChatBotResponseDto chatBotsControllerUpdate(id, updateChatBotDto)

Update a chat bot

Updates settings/permissions and reconnects the bot. Omitted or empty token fields keep the stored values.

### Example

```ts
import {
  Configuration,
  ChatBotsApi,
} from '@workspace/api-client';
import type { ChatBotsControllerUpdateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new ChatBotsApi();

  const body = {
    // string
    id: id_example,
    // UpdateChatBotDto
    updateChatBotDto: ...,
  } satisfies ChatBotsControllerUpdateRequest;

  try {
    const data = await api.chatBotsControllerUpdate(body);
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
| **updateChatBotDto** | [UpdateChatBotDto](UpdateChatBotDto.md) |  | |

### Return type

[**ChatBotResponseDto**](ChatBotResponseDto.md)

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

