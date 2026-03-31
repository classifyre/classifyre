# CustomDetectorExtractionsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**customDetectorExtractionsControllerCoverage**](CustomDetectorExtractionsApi.md#customdetectorextractionscontrollercoverage) | **GET** /custom-detectors/{id}/extractions/coverage |  |
| [**customDetectorExtractionsControllerGetByFinding**](CustomDetectorExtractionsApi.md#customdetectorextractionscontrollergetbyfinding) | **GET** /findings/{findingId}/extraction |  |
| [**customDetectorExtractionsControllerSearch**](CustomDetectorExtractionsApi.md#customdetectorextractionscontrollersearch) | **GET** /custom-detectors/{id}/extractions |  |



## customDetectorExtractionsControllerCoverage

> customDetectorExtractionsControllerCoverage(id)



### Example

```ts
import {
  Configuration,
  CustomDetectorExtractionsApi,
} from '@workspace/api-client';
import type { CustomDetectorExtractionsControllerCoverageRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomDetectorExtractionsApi();

  const body = {
    // string
    id: id_example,
  } satisfies CustomDetectorExtractionsControllerCoverageRequest;

  try {
    const data = await api.customDetectorExtractionsControllerCoverage(body);
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
| **200** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## customDetectorExtractionsControllerGetByFinding

> customDetectorExtractionsControllerGetByFinding(findingId)



### Example

```ts
import {
  Configuration,
  CustomDetectorExtractionsApi,
} from '@workspace/api-client';
import type { CustomDetectorExtractionsControllerGetByFindingRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomDetectorExtractionsApi();

  const body = {
    // string
    findingId: findingId_example,
  } satisfies CustomDetectorExtractionsControllerGetByFindingRequest;

  try {
    const data = await api.customDetectorExtractionsControllerGetByFinding(body);
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
| **findingId** | `string` |  | [Defaults to `undefined`] |

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


## customDetectorExtractionsControllerSearch

> customDetectorExtractionsControllerSearch(id)



### Example

```ts
import {
  Configuration,
  CustomDetectorExtractionsApi,
} from '@workspace/api-client';
import type { CustomDetectorExtractionsControllerSearchRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomDetectorExtractionsApi();

  const body = {
    // string
    id: id_example,
  } satisfies CustomDetectorExtractionsControllerSearchRequest;

  try {
    const data = await api.customDetectorExtractionsControllerSearch(body);
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
| **200** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

