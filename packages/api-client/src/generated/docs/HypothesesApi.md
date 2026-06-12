# HypothesesApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**hypothesisAliasControllerCreate**](HypothesesApi.md#hypothesisaliascontrollercreate) | **POST** /cases/{caseId}/hypotheses | [Deprecated] Create hypothesis — use POST /cases/:caseId/threads |
| [**hypothesisAliasControllerLinkSupport**](HypothesesApi.md#hypothesisaliascontrollerlinksupport) | **POST** /hypotheses/{id}/support | [Deprecated] Link support — use POST /threads/:id/support |
| [**hypothesisAliasControllerList**](HypothesesApi.md#hypothesisaliascontrollerlist) | **GET** /cases/{caseId}/hypotheses | [Deprecated] List hypotheses — use GET /cases/:caseId/threads?kind&#x3D;HYPOTHESIS |
| [**hypothesisAliasControllerRemove**](HypothesesApi.md#hypothesisaliascontrollerremove) | **DELETE** /hypotheses/{id} | [Deprecated] Delete hypothesis — use DELETE /threads/:id |
| [**hypothesisAliasControllerUnlinkSupport**](HypothesesApi.md#hypothesisaliascontrollerunlinksupport) | **DELETE** /hypotheses/{id}/support/{linkId} | [Deprecated] Unlink support — use DELETE /threads/:id/support/:linkId |
| [**hypothesisAliasControllerUpdate**](HypothesesApi.md#hypothesisaliascontrollerupdate) | **PATCH** /hypotheses/{id} | [Deprecated] Update hypothesis — use PATCH /threads/:id |



## hypothesisAliasControllerCreate

> HypothesisResponseDto hypothesisAliasControllerCreate(caseId, createHypothesisDto)

[Deprecated] Create hypothesis — use POST /cases/:caseId/threads

### Example

```ts
import {
  Configuration,
  HypothesesApi,
} from '@workspace/api-client';
import type { HypothesisAliasControllerCreateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new HypothesesApi();

  const body = {
    // string
    caseId: caseId_example,
    // CreateHypothesisDto
    createHypothesisDto: ...,
  } satisfies HypothesisAliasControllerCreateRequest;

  try {
    const data = await api.hypothesisAliasControllerCreate(body);
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


## hypothesisAliasControllerLinkSupport

> HypothesisResponseDto hypothesisAliasControllerLinkSupport(id, linkSupportDto)

[Deprecated] Link support — use POST /threads/:id/support

### Example

```ts
import {
  Configuration,
  HypothesesApi,
} from '@workspace/api-client';
import type { HypothesisAliasControllerLinkSupportRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new HypothesesApi();

  const body = {
    // string
    id: id_example,
    // LinkSupportDto
    linkSupportDto: ...,
  } satisfies HypothesisAliasControllerLinkSupportRequest;

  try {
    const data = await api.hypothesisAliasControllerLinkSupport(body);
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


## hypothesisAliasControllerList

> Array&lt;HypothesisResponseDto&gt; hypothesisAliasControllerList(caseId)

[Deprecated] List hypotheses — use GET /cases/:caseId/threads?kind&#x3D;HYPOTHESIS

### Example

```ts
import {
  Configuration,
  HypothesesApi,
} from '@workspace/api-client';
import type { HypothesisAliasControllerListRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new HypothesesApi();

  const body = {
    // string
    caseId: caseId_example,
  } satisfies HypothesisAliasControllerListRequest;

  try {
    const data = await api.hypothesisAliasControllerList(body);
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


## hypothesisAliasControllerRemove

> hypothesisAliasControllerRemove(id)

[Deprecated] Delete hypothesis — use DELETE /threads/:id

### Example

```ts
import {
  Configuration,
  HypothesesApi,
} from '@workspace/api-client';
import type { HypothesisAliasControllerRemoveRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new HypothesesApi();

  const body = {
    // string
    id: id_example,
  } satisfies HypothesisAliasControllerRemoveRequest;

  try {
    const data = await api.hypothesisAliasControllerRemove(body);
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


## hypothesisAliasControllerUnlinkSupport

> HypothesisResponseDto hypothesisAliasControllerUnlinkSupport(id, linkId)

[Deprecated] Unlink support — use DELETE /threads/:id/support/:linkId

### Example

```ts
import {
  Configuration,
  HypothesesApi,
} from '@workspace/api-client';
import type { HypothesisAliasControllerUnlinkSupportRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new HypothesesApi();

  const body = {
    // string
    id: id_example,
    // string
    linkId: linkId_example,
  } satisfies HypothesisAliasControllerUnlinkSupportRequest;

  try {
    const data = await api.hypothesisAliasControllerUnlinkSupport(body);
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


## hypothesisAliasControllerUpdate

> HypothesisResponseDto hypothesisAliasControllerUpdate(id, updateHypothesisDto)

[Deprecated] Update hypothesis — use PATCH /threads/:id

### Example

```ts
import {
  Configuration,
  HypothesesApi,
} from '@workspace/api-client';
import type { HypothesisAliasControllerUpdateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new HypothesesApi();

  const body = {
    // string
    id: id_example,
    // UpdateHypothesisDto
    updateHypothesisDto: ...,
  } satisfies HypothesisAliasControllerUpdateRequest;

  try {
    const data = await api.hypothesisAliasControllerUpdate(body);
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

