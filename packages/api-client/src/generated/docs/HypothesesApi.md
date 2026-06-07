# HypothesesApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**hypothesesControllerCreate**](HypothesesApi.md#hypothesescontrollercreate) | **POST** /cases/{caseId}/hypotheses | Create a hypothesis in a case |
| [**hypothesesControllerLinkSupport**](HypothesesApi.md#hypothesescontrollerlinksupport) | **POST** /hypotheses/{id}/support | Link evidence or a finding to a hypothesis with a stance |
| [**hypothesesControllerList**](HypothesesApi.md#hypothesescontrollerlist) | **GET** /cases/{caseId}/hypotheses | List hypotheses for a case |
| [**hypothesesControllerRemove**](HypothesesApi.md#hypothesescontrollerremove) | **DELETE** /hypotheses/{id} | Delete a hypothesis |
| [**hypothesesControllerUnlinkSupport**](HypothesesApi.md#hypothesescontrollerunlinksupport) | **DELETE** /hypotheses/{id}/support/{linkId} | Remove a support link from a hypothesis |
| [**hypothesesControllerUpdate**](HypothesesApi.md#hypothesescontrollerupdate) | **PATCH** /hypotheses/{id} | Update a hypothesis |



## hypothesesControllerCreate

> HypothesisResponseDto hypothesesControllerCreate(caseId, createHypothesisDto)

Create a hypothesis in a case

### Example

```ts
import {
  Configuration,
  HypothesesApi,
} from '@workspace/api-client';
import type { HypothesesControllerCreateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new HypothesesApi();

  const body = {
    // string
    caseId: caseId_example,
    // CreateHypothesisDto
    createHypothesisDto: ...,
  } satisfies HypothesesControllerCreateRequest;

  try {
    const data = await api.hypothesesControllerCreate(body);
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
| **caseId** | `string` |  | [Defaults to `undefined`] |
| **createHypothesisDto** | [CreateHypothesisDto](CreateHypothesisDto.md) |  | |

### Return type

[**HypothesisResponseDto**](HypothesisResponseDto.md)

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


## hypothesesControllerLinkSupport

> HypothesisResponseDto hypothesesControllerLinkSupport(id, linkSupportDto)

Link evidence or a finding to a hypothesis with a stance

### Example

```ts
import {
  Configuration,
  HypothesesApi,
} from '@workspace/api-client';
import type { HypothesesControllerLinkSupportRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new HypothesesApi();

  const body = {
    // string
    id: id_example,
    // LinkSupportDto
    linkSupportDto: ...,
  } satisfies HypothesesControllerLinkSupportRequest;

  try {
    const data = await api.hypothesesControllerLinkSupport(body);
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
| **linkSupportDto** | [LinkSupportDto](LinkSupportDto.md) |  | |

### Return type

[**HypothesisResponseDto**](HypothesisResponseDto.md)

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


## hypothesesControllerList

> Array&lt;HypothesisResponseDto&gt; hypothesesControllerList(caseId)

List hypotheses for a case

### Example

```ts
import {
  Configuration,
  HypothesesApi,
} from '@workspace/api-client';
import type { HypothesesControllerListRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new HypothesesApi();

  const body = {
    // string
    caseId: caseId_example,
  } satisfies HypothesesControllerListRequest;

  try {
    const data = await api.hypothesesControllerList(body);
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
| **caseId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**Array&lt;HypothesisResponseDto&gt;**](HypothesisResponseDto.md)

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


## hypothesesControllerRemove

> hypothesesControllerRemove(id)

Delete a hypothesis

### Example

```ts
import {
  Configuration,
  HypothesesApi,
} from '@workspace/api-client';
import type { HypothesesControllerRemoveRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new HypothesesApi();

  const body = {
    // string
    id: id_example,
  } satisfies HypothesesControllerRemoveRequest;

  try {
    const data = await api.hypothesesControllerRemove(body);
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
| **204** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## hypothesesControllerUnlinkSupport

> HypothesisResponseDto hypothesesControllerUnlinkSupport(id, linkId)

Remove a support link from a hypothesis

### Example

```ts
import {
  Configuration,
  HypothesesApi,
} from '@workspace/api-client';
import type { HypothesesControllerUnlinkSupportRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new HypothesesApi();

  const body = {
    // string
    id: id_example,
    // string
    linkId: linkId_example,
  } satisfies HypothesesControllerUnlinkSupportRequest;

  try {
    const data = await api.hypothesesControllerUnlinkSupport(body);
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
| **linkId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**HypothesisResponseDto**](HypothesisResponseDto.md)

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


## hypothesesControllerUpdate

> HypothesisResponseDto hypothesesControllerUpdate(id, updateHypothesisDto)

Update a hypothesis

### Example

```ts
import {
  Configuration,
  HypothesesApi,
} from '@workspace/api-client';
import type { HypothesesControllerUpdateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new HypothesesApi();

  const body = {
    // string
    id: id_example,
    // UpdateHypothesisDto
    updateHypothesisDto: ...,
  } satisfies HypothesesControllerUpdateRequest;

  try {
    const data = await api.hypothesesControllerUpdate(body);
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
| **updateHypothesisDto** | [UpdateHypothesisDto](UpdateHypothesisDto.md) |  | |

### Return type

[**HypothesisResponseDto**](HypothesisResponseDto.md)

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

