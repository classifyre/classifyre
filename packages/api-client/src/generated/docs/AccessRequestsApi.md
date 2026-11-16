# AccessRequestsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**accessRequestsControllerApprove**](AccessRequestsApi.md#accessrequestscontrollerapprove) | **POST** /data-access-requests/{id}/approve | Approve: the group gets an expiring Data reader grant on it |
| [**accessRequestsControllerCreate**](AccessRequestsApi.md#accessrequestscontrollercreate) | **POST** /data-access-requests | Ask to query a table or source, for a group of yours |
| [**accessRequestsControllerDeny**](AccessRequestsApi.md#accessrequestscontrollerdeny) | **POST** /data-access-requests/{id}/deny | Decline a request, saying why |
| [**accessRequestsControllerList**](AccessRequestsApi.md#accessrequestscontrollerlist) | **GET** /data-access-requests | Access requests: yours (view&#x3D;mine), waiting for you (view&#x3D;decide), or on one table or source you decide |
| [**accessRequestsControllerOptions**](AccessRequestsApi.md#accessrequestscontrolleroptions) | **GET** /data-access-requests/options | Asking for one table or source: your groups, who decides, a request of yours still waiting |
| [**accessRequestsControllerWithdraw**](AccessRequestsApi.md#accessrequestscontrollerwithdraw) | **POST** /data-access-requests/{id}/withdraw | Take back a request of yours still waiting |



## accessRequestsControllerApprove

> AccessRequestDto accessRequestsControllerApprove(id, approveAccessRequestDto)

Approve: the group gets an expiring Data reader grant on it

Its owner, else a steward, or someone with access.manage; never more than you hold on it, never your own request.

### Example

```ts
import {
  Configuration,
  AccessRequestsApi,
} from '@workspace/api-client';
import type { AccessRequestsControllerApproveRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessRequestsApi();

  const body = {
    // string
    id: id_example,
    // ApproveAccessRequestDto
    approveAccessRequestDto: ...,
  } satisfies AccessRequestsControllerApproveRequest;

  try {
    const data = await api.accessRequestsControllerApprove(body);
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
| **approveAccessRequestDto** | [ApproveAccessRequestDto](ApproveAccessRequestDto.md) |  | |

### Return type

[**AccessRequestDto**](AccessRequestDto.md)

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


## accessRequestsControllerCreate

> AccessRequestDto accessRequestsControllerCreate(createAccessRequestDto)

Ask to query a table or source, for a group of yours

### Example

```ts
import {
  Configuration,
  AccessRequestsApi,
} from '@workspace/api-client';
import type { AccessRequestsControllerCreateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessRequestsApi();

  const body = {
    // CreateAccessRequestDto
    createAccessRequestDto: ...,
  } satisfies AccessRequestsControllerCreateRequest;

  try {
    const data = await api.accessRequestsControllerCreate(body);
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
| **createAccessRequestDto** | [CreateAccessRequestDto](CreateAccessRequestDto.md) |  | |

### Return type

[**AccessRequestDto**](AccessRequestDto.md)

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


## accessRequestsControllerDeny

> AccessRequestDto accessRequestsControllerDeny(id, denyAccessRequestDto)

Decline a request, saying why

### Example

```ts
import {
  Configuration,
  AccessRequestsApi,
} from '@workspace/api-client';
import type { AccessRequestsControllerDenyRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessRequestsApi();

  const body = {
    // string
    id: id_example,
    // DenyAccessRequestDto
    denyAccessRequestDto: ...,
  } satisfies AccessRequestsControllerDenyRequest;

  try {
    const data = await api.accessRequestsControllerDeny(body);
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
| **denyAccessRequestDto** | [DenyAccessRequestDto](DenyAccessRequestDto.md) |  | |

### Return type

[**AccessRequestDto**](AccessRequestDto.md)

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


## accessRequestsControllerList

> Array&lt;AccessRequestDto&gt; accessRequestsControllerList(view, status, scopeType, scopeId)

Access requests: yours (view&#x3D;mine), waiting for you (view&#x3D;decide), or on one table or source you decide

### Example

```ts
import {
  Configuration,
  AccessRequestsApi,
} from '@workspace/api-client';
import type { AccessRequestsControllerListRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessRequestsApi();

  const body = {
    // 'mine' | 'decide' (optional)
    view: view_example,
    // string (optional)
    status: status_example,
    // 'asset' | 'source' (optional)
    scopeType: scopeType_example,
    // string (optional)
    scopeId: scopeId_example,
  } satisfies AccessRequestsControllerListRequest;

  try {
    const data = await api.accessRequestsControllerList(body);
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
| **view** | `mine`, `decide` |  | [Optional] [Defaults to `undefined`] [Enum: mine, decide] |
| **status** | `string` |  | [Optional] [Defaults to `undefined`] |
| **scopeType** | `asset`, `source` |  | [Optional] [Defaults to `undefined`] [Enum: asset, source] |
| **scopeId** | `string` |  | [Optional] [Defaults to `undefined`] |

### Return type

[**Array&lt;AccessRequestDto&gt;**](AccessRequestDto.md)

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


## accessRequestsControllerOptions

> AccessRequestOptionsDto accessRequestsControllerOptions(scopeType, scopeId)

Asking for one table or source: your groups, who decides, a request of yours still waiting

### Example

```ts
import {
  Configuration,
  AccessRequestsApi,
} from '@workspace/api-client';
import type { AccessRequestsControllerOptionsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessRequestsApi();

  const body = {
    // 'asset' | 'source'
    scopeType: scopeType_example,
    // string
    scopeId: scopeId_example,
  } satisfies AccessRequestsControllerOptionsRequest;

  try {
    const data = await api.accessRequestsControllerOptions(body);
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
| **scopeType** | `asset`, `source` |  | [Defaults to `undefined`] [Enum: asset, source] |
| **scopeId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**AccessRequestOptionsDto**](AccessRequestOptionsDto.md)

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


## accessRequestsControllerWithdraw

> AccessRequestDto accessRequestsControllerWithdraw(id)

Take back a request of yours still waiting

### Example

```ts
import {
  Configuration,
  AccessRequestsApi,
} from '@workspace/api-client';
import type { AccessRequestsControllerWithdrawRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessRequestsApi();

  const body = {
    // string
    id: id_example,
  } satisfies AccessRequestsControllerWithdrawRequest;

  try {
    const data = await api.accessRequestsControllerWithdraw(body);
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

[**AccessRequestDto**](AccessRequestDto.md)

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

