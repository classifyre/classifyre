# IdentityApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**auditControllerList**](IdentityApi.md#auditcontrollerlist) | **GET** /audit-events | Changes made in this workspace, newest first |
| [**auditControllerResolve**](IdentityApi.md#auditcontrollerresolve) | **GET** /actors/resolve | Display names for actor references |
| [**meControllerMe**](IdentityApi.md#mecontrollerme) | **GET** /me | Who is calling, and what they may do in this workspace |



## auditControllerList

> Array&lt;AuditEventDto&gt; auditControllerList(entityType, entityId, actor, before, limit)

Changes made in this workspace, newest first

Filter by entity (e.g. entityType&#x3D;sources&amp;entityId&#x3D;…) or by actor reference. Page with &#x60;before&#x60;, the id of the last event received.

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
    before: before_example,
    // number (optional)
    limit: 8.14,
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
| **before** | `string` |  | [Optional] [Defaults to `undefined`] |
| **limit** | `number` |  | [Optional] [Defaults to `undefined`] |

### Return type

[**Array&lt;AuditEventDto&gt;**](AuditEventDto.md)

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

