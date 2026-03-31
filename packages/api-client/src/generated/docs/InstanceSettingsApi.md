# InstanceSettingsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**aiProviderConfigControllerGetConfig**](InstanceSettingsApi.md#aiproviderconfigcontrollergetconfig) | **GET** /instance-settings/ai-provider | Get AI provider configuration |
| [**aiProviderConfigControllerUpdateConfig**](InstanceSettingsApi.md#aiproviderconfigcontrollerupdateconfig) | **PUT** /instance-settings/ai-provider | Update AI provider configuration |
| [**instanceSettingsControllerGetSettings**](InstanceSettingsApi.md#instancesettingscontrollergetsettings) | **GET** /instance-settings | Get instance settings |
| [**instanceSettingsControllerUpdateSettings**](InstanceSettingsApi.md#instancesettingscontrollerupdatesettings) | **PUT** /instance-settings | Update instance settings |
| [**mcpSettingsControllerCreateToken**](InstanceSettingsApi.md#mcpsettingscontrollercreatetoken) | **POST** /instance-settings/mcp/tokens | Create MCP access token |
| [**mcpSettingsControllerDeleteToken**](InstanceSettingsApi.md#mcpsettingscontrollerdeletetoken) | **DELETE** /instance-settings/mcp/tokens/{id} | Delete MCP access token |
| [**mcpSettingsControllerGetOverview**](InstanceSettingsApi.md#mcpsettingscontrollergetoverview) | **GET** /instance-settings/mcp/overview | Get MCP server overview |
| [**mcpSettingsControllerListTokens**](InstanceSettingsApi.md#mcpsettingscontrollerlisttokens) | **GET** /instance-settings/mcp/tokens | List MCP access tokens |
| [**mcpSettingsControllerUpdateToken**](InstanceSettingsApi.md#mcpsettingscontrollerupdatetoken) | **PATCH** /instance-settings/mcp/tokens/{id} | Update MCP access token |



## aiProviderConfigControllerGetConfig

> AiProviderConfigResponseDto aiProviderConfigControllerGetConfig()

Get AI provider configuration

Returns the current AI provider, model, base URL, and a masked API key preview.

### Example

```ts
import {
  Configuration,
  InstanceSettingsApi,
} from '@workspace/api-client';
import type { AiProviderConfigControllerGetConfigRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new InstanceSettingsApi();

  try {
    const data = await api.aiProviderConfigControllerGetConfig();
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


## aiProviderConfigControllerUpdateConfig

> AiProviderConfigResponseDto aiProviderConfigControllerUpdateConfig(updateAiProviderConfigDto)

Update AI provider configuration

Update any combination of provider, model, API key (plaintext — stored encrypted), and base URL. Pass apiKey as an empty string to clear a stored key.

### Example

```ts
import {
  Configuration,
  InstanceSettingsApi,
} from '@workspace/api-client';
import type { AiProviderConfigControllerUpdateConfigRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new InstanceSettingsApi();

  const body = {
    // UpdateAiProviderConfigDto
    updateAiProviderConfigDto: ...,
  } satisfies AiProviderConfigControllerUpdateConfigRequest;

  try {
    const data = await api.aiProviderConfigControllerUpdateConfig(body);
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


## instanceSettingsControllerGetSettings

> InstanceSettingsResponseDto instanceSettingsControllerGetSettings()

Get instance settings

Retrieve global instance-level settings used across the entire application.

### Example

```ts
import {
  Configuration,
  InstanceSettingsApi,
} from '@workspace/api-client';
import type { InstanceSettingsControllerGetSettingsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new InstanceSettingsApi();

  try {
    const data = await api.instanceSettingsControllerGetSettings();
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

[**InstanceSettingsResponseDto**](InstanceSettingsResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Instance settings payload |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## instanceSettingsControllerUpdateSettings

> InstanceSettingsResponseDto instanceSettingsControllerUpdateSettings(updateInstanceSettingsDto)

Update instance settings

Update global instance-level settings used across the entire application.

### Example

```ts
import {
  Configuration,
  InstanceSettingsApi,
} from '@workspace/api-client';
import type { InstanceSettingsControllerUpdateSettingsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new InstanceSettingsApi();

  const body = {
    // UpdateInstanceSettingsDto
    updateInstanceSettingsDto: ...,
  } satisfies InstanceSettingsControllerUpdateSettingsRequest;

  try {
    const data = await api.instanceSettingsControllerUpdateSettings(body);
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
| **updateInstanceSettingsDto** | [UpdateInstanceSettingsDto](UpdateInstanceSettingsDto.md) |  | |

### Return type

[**InstanceSettingsResponseDto**](InstanceSettingsResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Updated instance settings payload |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## mcpSettingsControllerCreateToken

> McpTokenCreatedResponseDto mcpSettingsControllerCreateToken(createMcpTokenDto)

Create MCP access token

Generates a new MCP bearer token, stores only its hash, and returns the plaintext token once.

### Example

```ts
import {
  Configuration,
  InstanceSettingsApi,
} from '@workspace/api-client';
import type { McpSettingsControllerCreateTokenRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new InstanceSettingsApi();

  const body = {
    // CreateMcpTokenDto
    createMcpTokenDto: ...,
  } satisfies McpSettingsControllerCreateTokenRequest;

  try {
    const data = await api.mcpSettingsControllerCreateToken(body);
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
| **createMcpTokenDto** | [CreateMcpTokenDto](CreateMcpTokenDto.md) |  | |

### Return type

[**McpTokenCreatedResponseDto**](McpTokenCreatedResponseDto.md)

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


## mcpSettingsControllerDeleteToken

> any mcpSettingsControllerDeleteToken(id)

Delete MCP access token

Deletes the stored token metadata and hash. This permanently invalidates the token.

### Example

```ts
import {
  Configuration,
  InstanceSettingsApi,
} from '@workspace/api-client';
import type { McpSettingsControllerDeleteTokenRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new InstanceSettingsApi();

  const body = {
    // string
    id: id_example,
  } satisfies McpSettingsControllerDeleteTokenRequest;

  try {
    const data = await api.mcpSettingsControllerDeleteToken(body);
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

**any**

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


## mcpSettingsControllerGetOverview

> McpOverviewResponseDto mcpSettingsControllerGetOverview()

Get MCP server overview

Returns MCP endpoint details, authentication guidance, prompts, and capability groups for the settings UI.

### Example

```ts
import {
  Configuration,
  InstanceSettingsApi,
} from '@workspace/api-client';
import type { McpSettingsControllerGetOverviewRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new InstanceSettingsApi();

  try {
    const data = await api.mcpSettingsControllerGetOverview();
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

[**McpOverviewResponseDto**](McpOverviewResponseDto.md)

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


## mcpSettingsControllerListTokens

> Array&lt;McpTokenResponseDto&gt; mcpSettingsControllerListTokens()

List MCP access tokens

Lists stored MCP tokens as masked previews. Raw token values are never returned.

### Example

```ts
import {
  Configuration,
  InstanceSettingsApi,
} from '@workspace/api-client';
import type { McpSettingsControllerListTokensRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new InstanceSettingsApi();

  try {
    const data = await api.mcpSettingsControllerListTokens();
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

[**Array&lt;McpTokenResponseDto&gt;**](McpTokenResponseDto.md)

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


## mcpSettingsControllerUpdateToken

> McpTokenResponseDto mcpSettingsControllerUpdateToken(id, updateMcpTokenDto)

Update MCP access token

Rename a token or toggle whether it can authorize MCP requests.

### Example

```ts
import {
  Configuration,
  InstanceSettingsApi,
} from '@workspace/api-client';
import type { McpSettingsControllerUpdateTokenRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new InstanceSettingsApi();

  const body = {
    // string
    id: id_example,
    // UpdateMcpTokenDto
    updateMcpTokenDto: ...,
  } satisfies McpSettingsControllerUpdateTokenRequest;

  try {
    const data = await api.mcpSettingsControllerUpdateToken(body);
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
| **updateMcpTokenDto** | [UpdateMcpTokenDto](UpdateMcpTokenDto.md) |  | |

### Return type

[**McpTokenResponseDto**](McpTokenResponseDto.md)

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

