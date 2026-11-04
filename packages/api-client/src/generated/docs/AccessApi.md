# AccessApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**tenantAccessControllerAddGrant**](AccessApi.md#tenantaccesscontrolleraddgrant) | **POST** /tenant/grants | Give a group or a person a role on the tenant, a group’s workspaces or one workspace |
| [**tenantAccessControllerEvents**](AccessApi.md#tenantaccesscontrollerevents) | **GET** /tenant/audit-events | Tenant-level changes: grants, workspaces created or deleted |
| [**tenantAccessControllerGrants**](AccessApi.md#tenantaccesscontrollergrants) | **GET** /tenant/grants | Every grant of the tenant |
| [**tenantAccessControllerGroups**](AccessApi.md#tenantaccesscontrollergroups) | **GET** /tenant/groups |  |
| [**tenantAccessControllerRemoveGrant**](AccessApi.md#tenantaccesscontrollerremovegrant) | **DELETE** /tenant/grants/{id} | Remove any grant of the tenant |
| [**tenantAccessControllerTenant**](AccessApi.md#tenantaccesscontrollertenant) | **GET** /tenant | The caller’s tenant and what they may do across it |
| [**workspaceAccessControllerAddGrant**](AccessApi.md#workspaceaccesscontrolleraddgrant) | **POST** /access/grants | Give a group or a person a role on this workspace |
| [**workspaceAccessControllerExplain**](AccessApi.md#workspaceaccesscontrollerexplain) | **GET** /access/explain | Why can I do this? The grants that give you a capability here |
| [**workspaceAccessControllerGrants**](AccessApi.md#workspaceaccesscontrollergrants) | **GET** /access/grants | Grants that reach this workspace, including inherited ones |
| [**workspaceAccessControllerGroups**](AccessApi.md#workspaceaccesscontrollergroups) | **GET** /access/groups | Groups of this tenant, to grant access to |
| [**workspaceAccessControllerRemoveGrant**](AccessApi.md#workspaceaccesscontrollerremovegrant) | **DELETE** /access/grants/{id} | Remove a grant made on this workspace |
| [**workspaceAccessControllerRoles**](AccessApi.md#workspaceaccesscontrollerroles) | **GET** /access/roles | The built-in roles and what each one allows |



## tenantAccessControllerAddGrant

> GrantDto tenantAccessControllerAddGrant(createGrantDto)

Give a group or a person a role on the tenant, a group’s workspaces or one workspace

### Example

```ts
import {
  Configuration,
  AccessApi,
} from '@workspace/api-client';
import type { TenantAccessControllerAddGrantRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessApi();

  const body = {
    // CreateGrantDto
    createGrantDto: ...,
  } satisfies TenantAccessControllerAddGrantRequest;

  try {
    const data = await api.tenantAccessControllerAddGrant(body);
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
| **createGrantDto** | [CreateGrantDto](CreateGrantDto.md) |  | |

### Return type

[**GrantDto**](GrantDto.md)

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


## tenantAccessControllerEvents

> Array&lt;TenantEventDto&gt; tenantAccessControllerEvents()

Tenant-level changes: grants, workspaces created or deleted

### Example

```ts
import {
  Configuration,
  AccessApi,
} from '@workspace/api-client';
import type { TenantAccessControllerEventsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessApi();

  try {
    const data = await api.tenantAccessControllerEvents();
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

[**Array&lt;TenantEventDto&gt;**](TenantEventDto.md)

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


## tenantAccessControllerGrants

> Array&lt;GrantDto&gt; tenantAccessControllerGrants()

Every grant of the tenant

### Example

```ts
import {
  Configuration,
  AccessApi,
} from '@workspace/api-client';
import type { TenantAccessControllerGrantsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessApi();

  try {
    const data = await api.tenantAccessControllerGrants();
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

[**Array&lt;GrantDto&gt;**](GrantDto.md)

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


## tenantAccessControllerGroups

> Array&lt;TenantGroupDto&gt; tenantAccessControllerGroups()



### Example

```ts
import {
  Configuration,
  AccessApi,
} from '@workspace/api-client';
import type { TenantAccessControllerGroupsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessApi();

  try {
    const data = await api.tenantAccessControllerGroups();
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

[**Array&lt;TenantGroupDto&gt;**](TenantGroupDto.md)

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


## tenantAccessControllerRemoveGrant

> tenantAccessControllerRemoveGrant(id)

Remove any grant of the tenant

### Example

```ts
import {
  Configuration,
  AccessApi,
} from '@workspace/api-client';
import type { TenantAccessControllerRemoveGrantRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessApi();

  const body = {
    // string
    id: id_example,
  } satisfies TenantAccessControllerRemoveGrantRequest;

  try {
    const data = await api.tenantAccessControllerRemoveGrant(body);
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


## tenantAccessControllerTenant

> TenantDto tenantAccessControllerTenant()

The caller’s tenant and what they may do across it

### Example

```ts
import {
  Configuration,
  AccessApi,
} from '@workspace/api-client';
import type { TenantAccessControllerTenantRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessApi();

  try {
    const data = await api.tenantAccessControllerTenant();
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

[**TenantDto**](TenantDto.md)

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


## workspaceAccessControllerAddGrant

> GrantDto workspaceAccessControllerAddGrant(createGrantDto)

Give a group or a person a role on this workspace

You can only give a role whose capabilities you all hold here (no escalation).

### Example

```ts
import {
  Configuration,
  AccessApi,
} from '@workspace/api-client';
import type { WorkspaceAccessControllerAddGrantRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessApi();

  const body = {
    // CreateGrantDto
    createGrantDto: ...,
  } satisfies WorkspaceAccessControllerAddGrantRequest;

  try {
    const data = await api.workspaceAccessControllerAddGrant(body);
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
| **createGrantDto** | [CreateGrantDto](CreateGrantDto.md) |  | |

### Return type

[**GrantDto**](GrantDto.md)

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


## workspaceAccessControllerExplain

> Array&lt;GrantDto&gt; workspaceAccessControllerExplain(capability)

Why can I do this? The grants that give you a capability here

### Example

```ts
import {
  Configuration,
  AccessApi,
} from '@workspace/api-client';
import type { WorkspaceAccessControllerExplainRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessApi();

  const body = {
    // string
    capability: capability_example,
  } satisfies WorkspaceAccessControllerExplainRequest;

  try {
    const data = await api.workspaceAccessControllerExplain(body);
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
| **capability** | `string` |  | [Defaults to `undefined`] |

### Return type

[**Array&lt;GrantDto&gt;**](GrantDto.md)

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


## workspaceAccessControllerGrants

> Array&lt;GrantDto&gt; workspaceAccessControllerGrants()

Grants that reach this workspace, including inherited ones

### Example

```ts
import {
  Configuration,
  AccessApi,
} from '@workspace/api-client';
import type { WorkspaceAccessControllerGrantsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessApi();

  try {
    const data = await api.workspaceAccessControllerGrants();
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

[**Array&lt;GrantDto&gt;**](GrantDto.md)

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


## workspaceAccessControllerGroups

> Array&lt;TenantGroupDto&gt; workspaceAccessControllerGroups()

Groups of this tenant, to grant access to

### Example

```ts
import {
  Configuration,
  AccessApi,
} from '@workspace/api-client';
import type { WorkspaceAccessControllerGroupsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessApi();

  try {
    const data = await api.workspaceAccessControllerGroups();
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

[**Array&lt;TenantGroupDto&gt;**](TenantGroupDto.md)

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


## workspaceAccessControllerRemoveGrant

> workspaceAccessControllerRemoveGrant(id)

Remove a grant made on this workspace

### Example

```ts
import {
  Configuration,
  AccessApi,
} from '@workspace/api-client';
import type { WorkspaceAccessControllerRemoveGrantRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessApi();

  const body = {
    // string
    id: id_example,
  } satisfies WorkspaceAccessControllerRemoveGrantRequest;

  try {
    const data = await api.workspaceAccessControllerRemoveGrant(body);
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


## workspaceAccessControllerRoles

> Array&lt;RoleDto&gt; workspaceAccessControllerRoles()

The built-in roles and what each one allows

### Example

```ts
import {
  Configuration,
  AccessApi,
} from '@workspace/api-client';
import type { WorkspaceAccessControllerRolesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessApi();

  try {
    const data = await api.workspaceAccessControllerRoles();
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

[**Array&lt;RoleDto&gt;**](RoleDto.md)

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

