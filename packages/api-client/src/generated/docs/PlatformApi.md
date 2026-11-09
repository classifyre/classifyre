# PlatformApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**platformControllerMe**](PlatformApi.md#platformcontrollerme) | **GET** /platform/me | Whether the caller is an operator (403 when not) |
| [**platformControllerRemove**](PlatformApi.md#platformcontrollerremove) | **DELETE** /platform/tenants/{tenantId} | Remove a tenant whose organization was deleted |
| [**platformControllerResume**](PlatformApi.md#platformcontrollerresume) | **POST** /platform/tenants/{tenantId}/resume | Resume a suspended tenant |
| [**platformControllerSuspend**](PlatformApi.md#platformcontrollersuspend) | **POST** /platform/tenants/{tenantId}/suspend | Suspend a tenant: its people are refused, its data is kept |
| [**platformControllerTenants**](PlatformApi.md#platformcontrollertenants) | **GET** /platform/tenants | Every tenant, with counts and its admins (read from the identity server) |



## platformControllerMe

> PlatformMeDto platformControllerMe()

Whether the caller is an operator (403 when not)

### Example

```ts
import {
  Configuration,
  PlatformApi,
} from '@workspace/api-client';
import type { PlatformControllerMeRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new PlatformApi();

  try {
    const data = await api.platformControllerMe();
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

[**PlatformMeDto**](PlatformMeDto.md)

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


## platformControllerRemove

> platformControllerRemove(tenantId, confirm)

Remove a tenant whose organization was deleted

Only after its organization was deleted in the identity server. Pass the alias as &#x60;confirm&#x60;. Its workspaces and their database go; the alias stays reserved.

### Example

```ts
import {
  Configuration,
  PlatformApi,
} from '@workspace/api-client';
import type { PlatformControllerRemoveRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new PlatformApi();

  const body = {
    // string
    tenantId: tenantId_example,
    // string
    confirm: confirm_example,
  } satisfies PlatformControllerRemoveRequest;

  try {
    const data = await api.platformControllerRemove(body);
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
| **tenantId** | `string` |  | [Defaults to `undefined`] |
| **confirm** | `string` |  | [Defaults to `undefined`] |

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


## platformControllerResume

> PlatformTenantDto platformControllerResume(tenantId)

Resume a suspended tenant

### Example

```ts
import {
  Configuration,
  PlatformApi,
} from '@workspace/api-client';
import type { PlatformControllerResumeRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new PlatformApi();

  const body = {
    // string
    tenantId: tenantId_example,
  } satisfies PlatformControllerResumeRequest;

  try {
    const data = await api.platformControllerResume(body);
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
| **tenantId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**PlatformTenantDto**](PlatformTenantDto.md)

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


## platformControllerSuspend

> PlatformTenantDto platformControllerSuspend(tenantId)

Suspend a tenant: its people are refused, its data is kept

### Example

```ts
import {
  Configuration,
  PlatformApi,
} from '@workspace/api-client';
import type { PlatformControllerSuspendRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new PlatformApi();

  const body = {
    // string
    tenantId: tenantId_example,
  } satisfies PlatformControllerSuspendRequest;

  try {
    const data = await api.platformControllerSuspend(body);
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
| **tenantId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**PlatformTenantDto**](PlatformTenantDto.md)

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


## platformControllerTenants

> Array&lt;PlatformTenantDto&gt; platformControllerTenants()

Every tenant, with counts and its admins (read from the identity server)

### Example

```ts
import {
  Configuration,
  PlatformApi,
} from '@workspace/api-client';
import type { PlatformControllerTenantsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new PlatformApi();

  try {
    const data = await api.platformControllerTenants();
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

[**Array&lt;PlatformTenantDto&gt;**](PlatformTenantDto.md)

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

