# AccessApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**tenantAccessControllerAddGrant**](AccessApi.md#tenantaccesscontrolleraddgrant) | **POST** /tenant/grants | Give a group or a person a role on the tenant, a group’s workspaces or one workspace |
| [**tenantAccessControllerEvents**](AccessApi.md#tenantaccesscontrollerevents) | **GET** /tenant/audit-events | Tenant-level changes: grants, workspaces created or deleted |
| [**tenantAccessControllerGrants**](AccessApi.md#tenantaccesscontrollergrants) | **GET** /tenant/grants | Every grant of the tenant |
| [**tenantAccessControllerGroups**](AccessApi.md#tenantaccesscontrollergroups) | **GET** /tenant/groups |  |
| [**tenantAccessControllerRemoveGrant**](AccessApi.md#tenantaccesscontrollerremovegrant) | **DELETE** /tenant/grants/{id} | Remove any grant of the tenant |
| [**tenantAccessControllerResolve**](AccessApi.md#tenantaccesscontrollerresolve) | **GET** /tenant/actors/resolve | Display names for actor references, outside any workspace |
| [**tenantAccessControllerRoles**](AccessApi.md#tenantaccesscontrollerroles) | **GET** /tenant/roles | The built-in roles and where each can be granted |
| [**tenantAccessControllerTenant**](AccessApi.md#tenantaccesscontrollertenant) | **GET** /tenant | The caller’s tenant and what they may do across it |
| [**tenantAccessControllerTenants**](AccessApi.md#tenantaccesscontrollertenants) | **GET** /tenant/tenants | Every tenant the caller belongs to, for switching (§12.2) |
| [**tenantPeopleControllerAdd**](AccessApi.md#tenantpeoplecontrolleradd) | **POST** /tenant/people | Add a person by email |
| [**tenantPeopleControllerAddMember**](AccessApi.md#tenantpeoplecontrolleraddmember) | **PUT** /tenant/groups/{groupId}/members/{userId} | Put a person of the tenant into a group |
| [**tenantPeopleControllerCreateGroup**](AccessApi.md#tenantpeoplecontrollercreategroup) | **POST** /tenant/groups | Create a group, at the top or inside another |
| [**tenantPeopleControllerDeleteGroup**](AccessApi.md#tenantpeoplecontrollerdeletegroup) | **DELETE** /tenant/groups/{groupId} | Delete a group and the groups below it, with their grants (refused while they own workspaces) |
| [**tenantPeopleControllerList**](AccessApi.md#tenantpeoplecontrollerlist) | **GET** /tenant/people | Everyone in the tenant, with their groups |
| [**tenantPeopleControllerRemove**](AccessApi.md#tenantpeoplecontrollerremove) | **DELETE** /tenant/people/{userId} | Remove a person from the tenant, its groups and their grants |
| [**tenantPeopleControllerRemoveMember**](AccessApi.md#tenantpeoplecontrollerremovemember) | **DELETE** /tenant/groups/{groupId}/members/{userId} | Take a person out of a group |
| [**tenantPeopleControllerRenameGroup**](AccessApi.md#tenantpeoplecontrollerrenamegroup) | **PATCH** /tenant/groups/{groupId} | Rename a group |
| [**tenantPeopleControllerResetPassword**](AccessApi.md#tenantpeoplecontrollerresetpassword) | **POST** /tenant/people/{userId}/password | Give an account made here a new temporary password |
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


## tenantAccessControllerResolve

> Array&lt;ResolvedActorDto&gt; tenantAccessControllerResolve(refs)

Display names for actor references, outside any workspace

People and agents resolve as in a workspace; MCP tokens belong to workspaces, so here they show as tokens.

### Example

```ts
import {
  Configuration,
  AccessApi,
} from '@workspace/api-client';
import type { TenantAccessControllerResolveRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessApi();

  const body = {
    // Array<string>
    refs: ...,
  } satisfies TenantAccessControllerResolveRequest;

  try {
    const data = await api.tenantAccessControllerResolve(body);
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
| **refs** | `Array<string>` |  | |

### Return type

[**Array&lt;ResolvedActorDto&gt;**](ResolvedActorDto.md)

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


## tenantAccessControllerRoles

> Array&lt;RoleDto&gt; tenantAccessControllerRoles()

The built-in roles and where each can be granted

### Example

```ts
import {
  Configuration,
  AccessApi,
} from '@workspace/api-client';
import type { TenantAccessControllerRolesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessApi();

  try {
    const data = await api.tenantAccessControllerRoles();
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


## tenantAccessControllerTenants

> Array&lt;TenantMembershipDto&gt; tenantAccessControllerTenants()

Every tenant the caller belongs to, for switching (§12.2)

### Example

```ts
import {
  Configuration,
  AccessApi,
} from '@workspace/api-client';
import type { TenantAccessControllerTenantsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessApi();

  try {
    const data = await api.tenantAccessControllerTenants();
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

[**Array&lt;TenantMembershipDto&gt;**](TenantMembershipDto.md)

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


## tenantPeopleControllerAdd

> AddedPersonDto tenantPeopleControllerAdd(addPersonDto)

Add a person by email

Creates an account with a temporary password (shown once), or adds an existing account that is in no tenant.

### Example

```ts
import {
  Configuration,
  AccessApi,
} from '@workspace/api-client';
import type { TenantPeopleControllerAddRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessApi();

  const body = {
    // AddPersonDto
    addPersonDto: ...,
  } satisfies TenantPeopleControllerAddRequest;

  try {
    const data = await api.tenantPeopleControllerAdd(body);
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
| **addPersonDto** | [AddPersonDto](AddPersonDto.md) |  | |

### Return type

[**AddedPersonDto**](AddedPersonDto.md)

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


## tenantPeopleControllerAddMember

> tenantPeopleControllerAddMember(groupId, userId)

Put a person of the tenant into a group

### Example

```ts
import {
  Configuration,
  AccessApi,
} from '@workspace/api-client';
import type { TenantPeopleControllerAddMemberRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessApi();

  const body = {
    // string
    groupId: groupId_example,
    // string
    userId: userId_example,
  } satisfies TenantPeopleControllerAddMemberRequest;

  try {
    const data = await api.tenantPeopleControllerAddMember(body);
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
| **groupId** | `string` |  | [Defaults to `undefined`] |
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


## tenantPeopleControllerCreateGroup

> TenantGroupDto tenantPeopleControllerCreateGroup(createGroupDto)

Create a group, at the top or inside another

### Example

```ts
import {
  Configuration,
  AccessApi,
} from '@workspace/api-client';
import type { TenantPeopleControllerCreateGroupRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessApi();

  const body = {
    // CreateGroupDto
    createGroupDto: ...,
  } satisfies TenantPeopleControllerCreateGroupRequest;

  try {
    const data = await api.tenantPeopleControllerCreateGroup(body);
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
| **createGroupDto** | [CreateGroupDto](CreateGroupDto.md) |  | |

### Return type

[**TenantGroupDto**](TenantGroupDto.md)

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


## tenantPeopleControllerDeleteGroup

> tenantPeopleControllerDeleteGroup(groupId)

Delete a group and the groups below it, with their grants (refused while they own workspaces)

### Example

```ts
import {
  Configuration,
  AccessApi,
} from '@workspace/api-client';
import type { TenantPeopleControllerDeleteGroupRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessApi();

  const body = {
    // string
    groupId: groupId_example,
  } satisfies TenantPeopleControllerDeleteGroupRequest;

  try {
    const data = await api.tenantPeopleControllerDeleteGroup(body);
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
| **groupId** | `string` |  | [Defaults to `undefined`] |

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


## tenantPeopleControllerList

> Array&lt;PersonDto&gt; tenantPeopleControllerList()

Everyone in the tenant, with their groups

### Example

```ts
import {
  Configuration,
  AccessApi,
} from '@workspace/api-client';
import type { TenantPeopleControllerListRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessApi();

  try {
    const data = await api.tenantPeopleControllerList();
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

[**Array&lt;PersonDto&gt;**](PersonDto.md)

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


## tenantPeopleControllerRemove

> RemovedPersonDto tenantPeopleControllerRemove(userId)

Remove a person from the tenant, its groups and their grants

### Example

```ts
import {
  Configuration,
  AccessApi,
} from '@workspace/api-client';
import type { TenantPeopleControllerRemoveRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessApi();

  const body = {
    // string
    userId: userId_example,
  } satisfies TenantPeopleControllerRemoveRequest;

  try {
    const data = await api.tenantPeopleControllerRemove(body);
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
| **userId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**RemovedPersonDto**](RemovedPersonDto.md)

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


## tenantPeopleControllerRemoveMember

> tenantPeopleControllerRemoveMember(groupId, userId)

Take a person out of a group

### Example

```ts
import {
  Configuration,
  AccessApi,
} from '@workspace/api-client';
import type { TenantPeopleControllerRemoveMemberRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessApi();

  const body = {
    // string
    groupId: groupId_example,
    // string
    userId: userId_example,
  } satisfies TenantPeopleControllerRemoveMemberRequest;

  try {
    const data = await api.tenantPeopleControllerRemoveMember(body);
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
| **groupId** | `string` |  | [Defaults to `undefined`] |
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


## tenantPeopleControllerRenameGroup

> TenantGroupDto tenantPeopleControllerRenameGroup(groupId, renameGroupDto)

Rename a group

### Example

```ts
import {
  Configuration,
  AccessApi,
} from '@workspace/api-client';
import type { TenantPeopleControllerRenameGroupRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessApi();

  const body = {
    // string
    groupId: groupId_example,
    // RenameGroupDto
    renameGroupDto: ...,
  } satisfies TenantPeopleControllerRenameGroupRequest;

  try {
    const data = await api.tenantPeopleControllerRenameGroup(body);
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
| **groupId** | `string` |  | [Defaults to `undefined`] |
| **renameGroupDto** | [RenameGroupDto](RenameGroupDto.md) |  | |

### Return type

[**TenantGroupDto**](TenantGroupDto.md)

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


## tenantPeopleControllerResetPassword

> TemporaryPasswordDto tenantPeopleControllerResetPassword(userId)

Give an account made here a new temporary password

### Example

```ts
import {
  Configuration,
  AccessApi,
} from '@workspace/api-client';
import type { TenantPeopleControllerResetPasswordRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AccessApi();

  const body = {
    // string
    userId: userId_example,
  } satisfies TenantPeopleControllerResetPasswordRequest;

  try {
    const data = await api.tenantPeopleControllerResetPassword(body);
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
| **userId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**TemporaryPasswordDto**](TemporaryPasswordDto.md)

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

