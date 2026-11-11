# SettingsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**deploymentSettingsControllerGet**](SettingsApi.md#deploymentsettingscontrollerget) | **GET** /runner-limits | Scan limits of this deployment: what is saved in Settings and what the chart or image sets |
| [**deploymentSettingsControllerUpdate**](SettingsApi.md#deploymentsettingscontrollerupdate) | **PUT** /runner-limits | Set scan limits for the whole deployment; null hands a limit back to the chart or image |



## deploymentSettingsControllerGet

> RunnerLimitsDto deploymentSettingsControllerGet()

Scan limits of this deployment: what is saved in Settings and what the chart or image sets

### Example

```ts
import {
  Configuration,
  SettingsApi,
} from '@workspace/api-client';
import type { DeploymentSettingsControllerGetRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SettingsApi();

  try {
    const data = await api.deploymentSettingsControllerGet();
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

[**RunnerLimitsDto**](RunnerLimitsDto.md)

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


## deploymentSettingsControllerUpdate

> RunnerLimitsDto deploymentSettingsControllerUpdate(updateRunnerLimitsDto)

Set scan limits for the whole deployment; null hands a limit back to the chart or image

### Example

```ts
import {
  Configuration,
  SettingsApi,
} from '@workspace/api-client';
import type { DeploymentSettingsControllerUpdateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SettingsApi();

  const body = {
    // UpdateRunnerLimitsDto
    updateRunnerLimitsDto: ...,
  } satisfies DeploymentSettingsControllerUpdateRequest;

  try {
    const data = await api.deploymentSettingsControllerUpdate(body);
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
| **updateRunnerLimitsDto** | [UpdateRunnerLimitsDto](UpdateRunnerLimitsDto.md) |  | |

### Return type

[**RunnerLimitsDto**](RunnerLimitsDto.md)

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

