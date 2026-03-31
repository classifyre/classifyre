# AIApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**aiControllerComplete**](AIApi.md#aicontrollercomplete) | **POST** /ai/complete | Generate a text completion |



## aiControllerComplete

> AiCompleteResponseDto aiControllerComplete(aiCompleteRequestDto)

Generate a text completion

Sends messages to the configured AI provider and returns a plain-text response.

### Example

```ts
import {
  Configuration,
  AIApi,
} from '@workspace/api-client';
import type { AiControllerCompleteRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AIApi();

  const body = {
    // AiCompleteRequestDto
    aiCompleteRequestDto: ...,
  } satisfies AiControllerCompleteRequest;

  try {
    const data = await api.aiControllerComplete(body);
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
| **aiCompleteRequestDto** | [AiCompleteRequestDto](AiCompleteRequestDto.md) |  | |

### Return type

[**AiCompleteResponseDto**](AiCompleteResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** |  |  -  |
| **502** | AI provider returned an error |  -  |
| **503** | AI provider not configured or rate limit hit |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

