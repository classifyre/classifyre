# AIProviderConfigsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**aiProviderConfigControllerCreate**](AIProviderConfigsApi.md#aiproviderconfigcontrollercreate) | **POST** /ai-provider-configs | Create an AI provider configuration |
| [**aiProviderConfigControllerGet**](AIProviderConfigsApi.md#aiproviderconfigcontrollerget) | **GET** /ai-provider-configs/{id} | Get a single AI provider configuration |
| [**aiProviderConfigControllerList**](AIProviderConfigsApi.md#aiproviderconfigcontrollerlist) | **GET** /ai-provider-configs | List AI provider configurations |
| [**aiProviderConfigControllerRemove**](AIProviderConfigsApi.md#aiproviderconfigcontrollerremove) | **DELETE** /ai-provider-configs/{id} | Delete an AI provider configuration |
| [**aiProviderConfigControllerTest**](AIProviderConfigsApi.md#aiproviderconfigcontrollertest) | **POST** /ai-provider-configs/{id}/test | Test an AI provider configuration |
| [**aiProviderConfigControllerUpdate**](AIProviderConfigsApi.md#aiproviderconfigcontrollerupdate) | **PUT** /ai-provider-configs/{id} | Update an AI provider configuration |



## aiProviderConfigControllerCreate

> AiProviderConfigResponseDto aiProviderConfigControllerCreate(createAiProviderConfigDto)

Create an AI provider configuration

Create a reusable credential. The API key is sent in plaintext and stored encrypted.

### Example

```ts
import {
  Configuration,
  AIProviderConfigsApi,
} from '@workspace/api-client';
import type { AiProviderConfigControllerCreateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AIProviderConfigsApi();

  const body = {
    // CreateAiProviderConfigDto
    createAiProviderConfigDto: ...,
  } satisfies AiProviderConfigControllerCreateRequest;

  try {
    const data = await api.aiProviderConfigControllerCreate(body);
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
| **createAiProviderConfigDto** | [CreateAiProviderConfigDto](CreateAiProviderConfigDto.md) |  | |

### Return type

[**AiProviderConfigResponseDto**](AiProviderConfigResponseDto.md)

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


## aiProviderConfigControllerGet

> AiProviderConfigResponseDto aiProviderConfigControllerGet(id)

Get a single AI provider configuration

### Example

```ts
import {
  Configuration,
  AIProviderConfigsApi,
} from '@workspace/api-client';
import type { AiProviderConfigControllerGetRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AIProviderConfigsApi();

  const body = {
    // string
    id: id_example,
  } satisfies AiProviderConfigControllerGetRequest;

  try {
    const data = await api.aiProviderConfigControllerGet(body);
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

[**AiProviderConfigResponseDto**](AiProviderConfigResponseDto.md)

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


## aiProviderConfigControllerList

> Array&lt;AiProviderConfigResponseDto&gt; aiProviderConfigControllerList()

List AI provider configurations

Returns all stored AI provider credentials with masked API key previews.

### Example

```ts
import {
  Configuration,
  AIProviderConfigsApi,
} from '@workspace/api-client';
import type { AiProviderConfigControllerListRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AIProviderConfigsApi();

  try {
    const data = await api.aiProviderConfigControllerList();
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

[**Array&lt;AiProviderConfigResponseDto&gt;**](AiProviderConfigResponseDto.md)

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


## aiProviderConfigControllerRemove

> aiProviderConfigControllerRemove(id)

Delete an AI provider configuration

### Example

```ts
import {
  Configuration,
  AIProviderConfigsApi,
} from '@workspace/api-client';
import type { AiProviderConfigControllerRemoveRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AIProviderConfigsApi();

  const body = {
    // string
    id: id_example,
  } satisfies AiProviderConfigControllerRemoveRequest;

  try {
    const data = await api.aiProviderConfigControllerRemove(body);
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


## aiProviderConfigControllerTest

> AiProviderConfigTestResultDto aiProviderConfigControllerTest(id)

Test an AI provider configuration

Runs a small structured-JSON round-trip against the given credential to verify the provider, model, and API key work.

### Example

```ts
import {
  Configuration,
  AIProviderConfigsApi,
} from '@workspace/api-client';
import type { AiProviderConfigControllerTestRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AIProviderConfigsApi();

  const body = {
    // string
    id: id_example,
  } satisfies AiProviderConfigControllerTestRequest;

  try {
    const data = await api.aiProviderConfigControllerTest(body);
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

[**AiProviderConfigTestResultDto**](AiProviderConfigTestResultDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** |  |  -  |
| **502** | AI provider returned an error |  -  |
| **503** | AI provider not configured or rate limit hit |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## aiProviderConfigControllerUpdate

> AiProviderConfigResponseDto aiProviderConfigControllerUpdate(id, updateAiProviderConfigDto)

Update an AI provider configuration

Update any combination of name, provider, model, API key (plaintext — stored encrypted), base URL, and context size. Pass apiKey as an empty string to clear a stored key.

### Example

```ts
import {
  Configuration,
  AIProviderConfigsApi,
} from '@workspace/api-client';
import type { AiProviderConfigControllerUpdateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AIProviderConfigsApi();

  const body = {
    // string
    id: id_example,
    // UpdateAiProviderConfigDto
    updateAiProviderConfigDto: ...,
  } satisfies AiProviderConfigControllerUpdateRequest;

  try {
    const data = await api.aiProviderConfigControllerUpdate(body);
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
| **updateAiProviderConfigDto** | [UpdateAiProviderConfigDto](UpdateAiProviderConfigDto.md) |  | |

### Return type

[**AiProviderConfigResponseDto**](AiProviderConfigResponseDto.md)

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

