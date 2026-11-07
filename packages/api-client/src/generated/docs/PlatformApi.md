# PlatformApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**platformControllerAddAdmin**](PlatformApi.md#platformcontrolleraddadmin) | **POST** /platform/tenants/{tenantId}/admins | Make someone a tenant admin, by email |
| [**platformControllerCreate**](PlatformApi.md#platformcontrollercreate) | **POST** /platform/tenants | Create a tenant with its first admin |
| [**platformControllerImportWorkspaces**](PlatformApi.md#platformcontrollerimportworkspaces) | **POST** /platform/tenants/{tenantId}/workspaces | Bring workspaces made without sign-in into a tenant |
| [**platformControllerLocalWorkspaces**](PlatformApi.md#platformcontrollerlocalworkspaces) | **GET** /platform/workspaces/local | Workspaces made without sign-in, which can be brought into a tenant |
| [**platformControllerMe**](PlatformApi.md#platformcontrollerme) | **GET** /platform/me | Whether the caller is an operator (403 when not) |
| [**platformControllerRemove**](PlatformApi.md#platformcontrollerremove) | **DELETE** /platform/tenants/{tenantId} | Delete a tenant that has no workspaces left |
| [**platformControllerRemoveAdmin**](PlatformApi.md#platformcontrollerremoveadmin) | **DELETE** /platform/tenants/{tenantId}/admins/{userId} | Take someone out of the tenant\&#39;s admins |
| [**platformControllerResume**](PlatformApi.md#platformcontrollerresume) | **POST** /platform/tenants/{tenantId}/resume | Resume a suspended tenant |
| [**platformControllerSuspend**](PlatformApi.md#platformcontrollersuspend) | **POST** /platform/tenants/{tenantId}/suspend | Suspend a tenant: its people are refused, its data is kept |
| [**platformControllerTenants**](PlatformApi.md#platformcontrollertenants) | **GET** /platform/tenants | Every tenant, with counts and its admins |



## platformControllerAddAdmin

> AddedTenantAdminDto platformControllerAddAdmin(tenantId, addTenantAdminDto)

Make someone a tenant admin, by email

A member of the tenant, an account in no tenant, or a new account with a temporary password (shown once).

### Example

```ts
import {
  Configuration,
  PlatformApi,
} from '@workspace/api-client';
import type { PlatformControllerAddAdminRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new PlatformApi();

  const body = {
    // string
    tenantId: tenantId_example,
    // AddTenantAdminDto
    addTenantAdminDto: ...,
  } satisfies PlatformControllerAddAdminRequest;

  try {
    const data = await api.platformControllerAddAdmin(body);
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
| **addTenantAdminDto** | [AddTenantAdminDto](AddTenantAdminDto.md) |  | |

### Return type

[**AddedTenantAdminDto**](AddedTenantAdminDto.md)

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


## platformControllerCreate

> CreatedTenantDto platformControllerCreate(createTenantDto)

Create a tenant with its first admin

Creates the organization, its &#x60;admins&#x60; group and the first admin: an account in no tenant, or a new one with a temporary password (shown once).

### Example

```ts
import {
  Configuration,
  PlatformApi,
} from '@workspace/api-client';
import type { PlatformControllerCreateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new PlatformApi();

  const body = {
    // CreateTenantDto
    createTenantDto: ...,
  } satisfies PlatformControllerCreateRequest;

  try {
    const data = await api.platformControllerCreate(body);
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
| **createTenantDto** | [CreateTenantDto](CreateTenantDto.md) |  | |

### Return type

[**CreatedTenantDto**](CreatedTenantDto.md)

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


## platformControllerImportWorkspaces

> ImportedWorkspacesDto platformControllerImportWorkspaces(tenantId, importWorkspacesDto)

Bring workspaces made without sign-in into a tenant

### Example

```ts
import {
  Configuration,
  PlatformApi,
} from '@workspace/api-client';
import type { PlatformControllerImportWorkspacesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new PlatformApi();

  const body = {
    // string
    tenantId: tenantId_example,
    // ImportWorkspacesDto
    importWorkspacesDto: ...,
  } satisfies PlatformControllerImportWorkspacesRequest;

  try {
    const data = await api.platformControllerImportWorkspaces(body);
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
| **importWorkspacesDto** | [ImportWorkspacesDto](ImportWorkspacesDto.md) |  | |

### Return type

[**ImportedWorkspacesDto**](ImportedWorkspacesDto.md)

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


## platformControllerLocalWorkspaces

> Array&lt;LocalWorkspaceDto&gt; platformControllerLocalWorkspaces()

Workspaces made without sign-in, which can be brought into a tenant

### Example

```ts
import {
  Configuration,
  PlatformApi,
} from '@workspace/api-client';
import type { PlatformControllerLocalWorkspacesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new PlatformApi();

  try {
    const data = await api.platformControllerLocalWorkspaces();
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

[**Array&lt;LocalWorkspaceDto&gt;**](LocalWorkspaceDto.md)

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

Delete a tenant that has no workspaces left

Pass the alias as &#x60;confirm&#x60;. The organization and the accounts made for it go; the alias stays reserved.

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


## platformControllerRemoveAdmin

> platformControllerRemoveAdmin(tenantId, userId)

Take someone out of the tenant\&#39;s admins

### Example

```ts
import {
  Configuration,
  PlatformApi,
} from '@workspace/api-client';
import type { PlatformControllerRemoveAdminRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new PlatformApi();

  const body = {
    // string
    tenantId: tenantId_example,
    // string
    userId: userId_example,
  } satisfies PlatformControllerRemoveAdminRequest;

  try {
    const data = await api.platformControllerRemoveAdmin(body);
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
| **userId** | `string` |  | [Defaults to `undefined`] |

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

Every tenant, with counts and its admins

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

