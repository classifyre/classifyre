# AssistantApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**assistantControllerParseUpload**](AssistantApi.md#assistantcontrollerparseupload) | **POST** /assistant/parse-upload | Parse assistant chat upload |
| [**assistantControllerRespond**](AssistantApi.md#assistantcontrollerrespondoperation) | **POST** /assistant/respond | Respond to a contextual assistant turn |



## assistantControllerParseUpload

> object assistantControllerParseUpload(file)

Parse assistant chat upload

Accepts csv/tsv/txt/md/log/json file and returns structured payload suitable for assistant context.

### Example

```ts
import {
  Configuration,
  AssistantApi,
} from '@workspace/api-client';
import type { AssistantControllerParseUploadRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AssistantApi();

  const body = {
    // Blob
    file: BINARY_DATA_HERE,
  } satisfies AssistantControllerParseUploadRequest;

  try {
    const data = await api.assistantControllerParseUpload(body);
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
| **file** | `Blob` |  | [Defaults to `undefined`] |

### Return type

**object**

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `multipart/form-data`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## assistantControllerRespond

> AssistantControllerRespond200Response assistantControllerRespond(assistantControllerRespondRequest)

Respond to a contextual assistant turn

Accepts the current page context and transcript, returns assistant text plus typed UI actions.

### Example

```ts
import {
  Configuration,
  AssistantApi,
} from '@workspace/api-client';
import type { AssistantControllerRespondOperationRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AssistantApi();

  const body = {
    // AssistantControllerRespondRequest
    assistantControllerRespondRequest: ...,
  } satisfies AssistantControllerRespondOperationRequest;

  try {
    const data = await api.assistantControllerRespond(body);
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
| **assistantControllerRespondRequest** | [AssistantControllerRespondRequest](AssistantControllerRespondRequest.md) |  | |

### Return type

[**AssistantControllerRespond200Response**](AssistantControllerRespond200Response.md)

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

