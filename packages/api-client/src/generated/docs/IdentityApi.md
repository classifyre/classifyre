# IdentityApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**meControllerMe**](IdentityApi.md#mecontrollerme) | **GET** /me | Who is calling, and what they may do in this workspace |



## meControllerMe

> MeResponseDto meControllerMe()

Who is calling, and what they may do in this workspace

### Example

```ts
import {
  Configuration,
  IdentityApi,
} from '@workspace/api-client';
import type { MeControllerMeRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new IdentityApi();

  try {
    const data = await api.meControllerMe();
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

[**MeResponseDto**](MeResponseDto.md)

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

