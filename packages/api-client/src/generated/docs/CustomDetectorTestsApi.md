# CustomDetectorTestsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**customDetectorTestsControllerCreate**](CustomDetectorTestsApi.md#customdetectortestscontrollercreate) | **POST** /custom-detectors/{detectorId}/test-scenarios |  |
| [**customDetectorTestsControllerDelete**](CustomDetectorTestsApi.md#customdetectortestscontrollerdelete) | **DELETE** /custom-detectors/{detectorId}/test-scenarios/{scenarioId} |  |
| [**customDetectorTestsControllerList**](CustomDetectorTestsApi.md#customdetectortestscontrollerlist) | **GET** /custom-detectors/{detectorId}/test-scenarios |  |
| [**customDetectorTestsControllerRun**](CustomDetectorTestsApi.md#customdetectortestscontrollerrun) | **POST** /custom-detectors/{detectorId}/test-scenarios/run |  |



## customDetectorTestsControllerCreate

> customDetectorTestsControllerCreate(detectorId)



### Example

```ts
import {
  Configuration,
  CustomDetectorTestsApi,
} from '@workspace/api-client';
import type { CustomDetectorTestsControllerCreateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomDetectorTestsApi();

  const body = {
    // string
    detectorId: detectorId_example,
  } satisfies CustomDetectorTestsControllerCreateRequest;

  try {
    const data = await api.customDetectorTestsControllerCreate(body);
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
| **detectorId** | `string` |  | [Defaults to `undefined`] |

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
| **201** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## customDetectorTestsControllerDelete

> customDetectorTestsControllerDelete(detectorId, scenarioId)



### Example

```ts
import {
  Configuration,
  CustomDetectorTestsApi,
} from '@workspace/api-client';
import type { CustomDetectorTestsControllerDeleteRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomDetectorTestsApi();

  const body = {
    // string
    detectorId: detectorId_example,
    // string
    scenarioId: scenarioId_example,
  } satisfies CustomDetectorTestsControllerDeleteRequest;

  try {
    const data = await api.customDetectorTestsControllerDelete(body);
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
| **detectorId** | `string` |  | [Defaults to `undefined`] |
| **scenarioId** | `string` |  | [Defaults to `undefined`] |

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


## customDetectorTestsControllerList

> customDetectorTestsControllerList(detectorId)



### Example

```ts
import {
  Configuration,
  CustomDetectorTestsApi,
} from '@workspace/api-client';
import type { CustomDetectorTestsControllerListRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomDetectorTestsApi();

  const body = {
    // string
    detectorId: detectorId_example,
  } satisfies CustomDetectorTestsControllerListRequest;

  try {
    const data = await api.customDetectorTestsControllerList(body);
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
| **detectorId** | `string` |  | [Defaults to `undefined`] |

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
| **200** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## customDetectorTestsControllerRun

> customDetectorTestsControllerRun(detectorId, triggeredBy)



### Example

```ts
import {
  Configuration,
  CustomDetectorTestsApi,
} from '@workspace/api-client';
import type { CustomDetectorTestsControllerRunRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomDetectorTestsApi();

  const body = {
    // string
    detectorId: detectorId_example,
    // string
    triggeredBy: triggeredBy_example,
  } satisfies CustomDetectorTestsControllerRunRequest;

  try {
    const data = await api.customDetectorTestsControllerRun(body);
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
| **detectorId** | `string` |  | [Defaults to `undefined`] |
| **triggeredBy** | `string` |  | [Defaults to `undefined`] |

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
| **201** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

