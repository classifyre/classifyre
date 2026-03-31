# HealthApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**healthControllerGetHealth**](HealthApi.md#healthcontrollergethealth) | **GET** / | Health check |
| [**healthControllerPing**](HealthApi.md#healthcontrollerping) | **GET** /ping | Ping endpoint |



## healthControllerGetHealth

> HealthControllerGetHealth200Response healthControllerGetHealth()

Health check

Check if the API is running and healthy

### Example

```ts
import {
  Configuration,
  HealthApi,
} from '@workspace/api-client';
import type { HealthControllerGetHealthRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new HealthApi();

  try {
    const data = await api.healthControllerGetHealth();
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

[**HealthControllerGetHealth200Response**](HealthControllerGetHealth200Response.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | API is healthy |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## healthControllerPing

> string healthControllerPing()

Ping endpoint

Simple ping to check API responsiveness

### Example

```ts
import {
  Configuration,
  HealthApi,
} from '@workspace/api-client';
import type { HealthControllerPingRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new HealthApi();

  try {
    const data = await api.healthControllerPing();
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

**string**

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Pong response |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

