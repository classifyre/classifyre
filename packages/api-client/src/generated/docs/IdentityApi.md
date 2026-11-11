# IdentityApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**auditControllerList**](IdentityApi.md#auditcontrollerlist) | **GET** /audit-events | Changes made in this workspace, newest first |
| [**auditControllerResolve**](IdentityApi.md#auditcontrollerresolve) | **GET** /actors/resolve | Display names for actor references |
| [**meControllerMe**](IdentityApi.md#mecontrollerme) | **GET** /me | Who is calling, and what they may do in this workspace |



## auditControllerList

> AuditEventsResponseDto auditControllerList(entityType, entityId, actor, capability, operation, resource, search, before, limit, skip, sortBy, sortOrder)

Changes made in this workspace, newest first

Filter by entity (e.g. entityType&#x3D;sources&amp;entityId&#x3D;…), by what it touched (resource&#x3D;data, source:&lt;id&gt; or asset:&lt;id&gt;), actor, capability, operation or free text. Sort any column; page with &#x60;skip&#x60;/&#x60;limit&#x60; or, for \&quot;load more\&quot;, with &#x60;before&#x60;, the id of the last event received.

### Example

```ts
import {
  Configuration,
  IdentityApi,
} from '@workspace/api-client';
import type { AuditControllerListRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new IdentityApi();

  const body = {
    // string (optional)
    entityType: entityType_example,
    // string (optional)
    entityId: entityId_example,
    // string (optional)
    actor: actor_example,
    // string (optional)
    capability: capability_example,
    // string (optional)
    operation: operation_example,
    // string | Only events that touched this: `data` (SQL reads and data-reader grants), `source:<id>` or `asset:<id>`. (optional)
    resource: resource_example,
    // string (optional)
    search: search_example,
    // string (optional)
    before: before_example,
    // number (optional)
    limit: 8.14,
    // number (optional)
    skip: 8.14,
    // 'OCCURRED_AT' | 'ACTOR' | 'OPERATION' | 'ENTITY_TYPE' | 'CAPABILITY' (optional)
    sortBy: sortBy_example,
    // 'ASC' | 'DESC' (optional)
    sortOrder: sortOrder_example,
  } satisfies AuditControllerListRequest;

  try {
    const data = await api.auditControllerList(body);
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
| **entityType** | `string` |  | [Optional] [Defaults to `undefined`] |
| **entityId** | `string` |  | [Optional] [Defaults to `undefined`] |
| **actor** | `string` |  | [Optional] [Defaults to `undefined`] |
| **capability** | `string` |  | [Optional] [Defaults to `undefined`] |
| **operation** | `string` |  | [Optional] [Defaults to `undefined`] |
| **resource** | `string` | Only events that touched this: &#x60;data&#x60; (SQL reads and data-reader grants), &#x60;source:&lt;id&gt;&#x60; or &#x60;asset:&lt;id&gt;&#x60;. | [Optional] [Defaults to `undefined`] |
| **search** | `string` |  | [Optional] [Defaults to `undefined`] |
| **before** | `string` |  | [Optional] [Defaults to `undefined`] |
| **limit** | `number` |  | [Optional] [Defaults to `undefined`] |
| **skip** | `number` |  | [Optional] [Defaults to `undefined`] |
| **sortBy** | `OCCURRED_AT`, `ACTOR`, `OPERATION`, `ENTITY_TYPE`, `CAPABILITY` |  | [Optional] [Defaults to `undefined`] [Enum: OCCURRED_AT, ACTOR, OPERATION, ENTITY_TYPE, CAPABILITY] |
| **sortOrder** | `ASC`, `DESC` |  | [Optional] [Defaults to `undefined`] [Enum: ASC, DESC] |

### Return type

[**AuditEventsResponseDto**](AuditEventsResponseDto.md)

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


## auditControllerResolve

> Array&lt;ResolvedActorDto&gt; auditControllerResolve(refs)

Display names for actor references

Repeat &#x60;refs&#x60; once per reference (&#x60;?refs&#x3D;a&amp;refs&#x3D;b&#x60;), at most 200. Names may contain commas, so the list is never comma-separated.

### Example

```ts
import {
  Configuration,
  IdentityApi,
} from '@workspace/api-client';
import type { AuditControllerResolveRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new IdentityApi();

  const body = {
    // Array<string>
    refs: ...,
  } satisfies AuditControllerResolveRequest;

  try {
    const data = await api.auditControllerResolve(body);
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

