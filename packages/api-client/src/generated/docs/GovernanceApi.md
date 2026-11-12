# GovernanceApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**governanceControllerAssetColumns**](GovernanceApi.md#governancecontrollerassetcolumns) | **GET** /assets/{id}/columns | A table\&#39;s columns: what stewards said and what open findings classify |
| [**governanceControllerAssetGovernance**](GovernanceApi.md#governancecontrollerassetgovernance) | **GET** /assets/{id}/governance | An asset\&#39;s owners, description, lifecycle and checklist |
| [**governanceControllerAssignAssetRole**](GovernanceApi.md#governancecontrollerassignassetrole) | **POST** /assets/{id}/governance/roles | Make someone owner, steward or custodian of an asset |
| [**governanceControllerAssignSourceRole**](GovernanceApi.md#governancecontrollerassignsourcerole) | **POST** /sources/{id}/governance/roles | Make someone owner, steward or custodian of a source |
| [**governanceControllerMoveColumn**](GovernanceApi.md#governancecontrollermovecolumn) | **POST** /assets/{id}/columns/{name}/move | Move a removed column\&#39;s annotations to the column it became |
| [**governanceControllerPrincipals**](GovernanceApi.md#governancecontrollerprincipals) | **GET** /governance/principals | People and groups of the tenant, for the owner and steward pickers |
| [**governanceControllerRemoveAssetRole**](GovernanceApi.md#governancecontrollerremoveassetrole) | **DELETE** /assets/{id}/governance/roles/{roleId} | End a role on an asset (kept as history) |
| [**governanceControllerRemoveColumn**](GovernanceApi.md#governancecontrollerremovecolumn) | **DELETE** /assets/{id}/columns/{name} | Forget what was said about one column |
| [**governanceControllerRemoveSourceRole**](GovernanceApi.md#governancecontrollerremovesourcerole) | **DELETE** /sources/{id}/governance/roles/{roleId} | End a role on a source (kept as history) |
| [**governanceControllerSourceGovernance**](GovernanceApi.md#governancecontrollersourcegovernance) | **GET** /sources/{id}/governance | A source\&#39;s owners, stewards and custodians, and its coverage |
| [**governanceControllerSummary**](GovernanceApi.md#governancecontrollersummary) | **GET** /governance/summary | How far the workspace is governed: coverage per source, what to govern first, yours |
| [**governanceControllerUpdateAssetGovernance**](GovernanceApi.md#governancecontrollerupdateassetgovernance) | **PUT** /assets/{id}/governance | Change an asset\&#39;s description, legal basis or lifecycle |
| [**governanceControllerUpdateColumn**](GovernanceApi.md#governancecontrollerupdatecolumn) | **PUT** /assets/{id}/columns/{name} | Describe, classify or confirm one column |
| [**governanceControllerUsage**](GovernanceApi.md#governancecontrollerusage) | **GET** /assets/{id}/usage | Who read and exported a table, per day, over the last days |



## governanceControllerAssetColumns

> AssetColumnsDto governanceControllerAssetColumns(id)

A table\&#39;s columns: what stewards said and what open findings classify

### Example

```ts
import {
  Configuration,
  GovernanceApi,
} from '@workspace/api-client';
import type { GovernanceControllerAssetColumnsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GovernanceApi();

  const body = {
    // string
    id: id_example,
  } satisfies GovernanceControllerAssetColumnsRequest;

  try {
    const data = await api.governanceControllerAssetColumns(body);
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

[**AssetColumnsDto**](AssetColumnsDto.md)

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


## governanceControllerAssetGovernance

> AssetGovernanceDto governanceControllerAssetGovernance(id)

An asset\&#39;s owners, description, lifecycle and checklist

### Example

```ts
import {
  Configuration,
  GovernanceApi,
} from '@workspace/api-client';
import type { GovernanceControllerAssetGovernanceRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GovernanceApi();

  const body = {
    // string
    id: id_example,
  } satisfies GovernanceControllerAssetGovernanceRequest;

  try {
    const data = await api.governanceControllerAssetGovernance(body);
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

[**AssetGovernanceDto**](AssetGovernanceDto.md)

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


## governanceControllerAssignAssetRole

> AssetGovernanceDto governanceControllerAssignAssetRole(id, assignGovernanceRoleDto)

Make someone owner, steward or custodian of an asset

A new owner replaces the current one; the old row is kept as history.

### Example

```ts
import {
  Configuration,
  GovernanceApi,
} from '@workspace/api-client';
import type { GovernanceControllerAssignAssetRoleRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GovernanceApi();

  const body = {
    // string
    id: id_example,
    // AssignGovernanceRoleDto
    assignGovernanceRoleDto: ...,
  } satisfies GovernanceControllerAssignAssetRoleRequest;

  try {
    const data = await api.governanceControllerAssignAssetRole(body);
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
| **assignGovernanceRoleDto** | [AssignGovernanceRoleDto](AssignGovernanceRoleDto.md) |  | |

### Return type

[**AssetGovernanceDto**](AssetGovernanceDto.md)

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


## governanceControllerAssignSourceRole

> SourceGovernanceDto governanceControllerAssignSourceRole(id, assignGovernanceRoleDto)

Make someone owner, steward or custodian of a source

Roles on a source apply to its assets that set none of their own.

### Example

```ts
import {
  Configuration,
  GovernanceApi,
} from '@workspace/api-client';
import type { GovernanceControllerAssignSourceRoleRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GovernanceApi();

  const body = {
    // string
    id: id_example,
    // AssignGovernanceRoleDto
    assignGovernanceRoleDto: ...,
  } satisfies GovernanceControllerAssignSourceRoleRequest;

  try {
    const data = await api.governanceControllerAssignSourceRole(body);
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
| **assignGovernanceRoleDto** | [AssignGovernanceRoleDto](AssignGovernanceRoleDto.md) |  | |

### Return type

[**SourceGovernanceDto**](SourceGovernanceDto.md)

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


## governanceControllerMoveColumn

> AssetColumnsDto governanceControllerMoveColumn(id, name, moveAssetColumnDto)

Move a removed column\&#39;s annotations to the column it became

### Example

```ts
import {
  Configuration,
  GovernanceApi,
} from '@workspace/api-client';
import type { GovernanceControllerMoveColumnRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GovernanceApi();

  const body = {
    // string
    id: id_example,
    // string
    name: name_example,
    // MoveAssetColumnDto
    moveAssetColumnDto: ...,
  } satisfies GovernanceControllerMoveColumnRequest;

  try {
    const data = await api.governanceControllerMoveColumn(body);
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
| **name** | `string` |  | [Defaults to `undefined`] |
| **moveAssetColumnDto** | [MoveAssetColumnDto](MoveAssetColumnDto.md) |  | |

### Return type

[**AssetColumnsDto**](AssetColumnsDto.md)

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


## governanceControllerPrincipals

> Array&lt;GovernancePrincipalDto&gt; governanceControllerPrincipals(q, kinds)

People and groups of the tenant, for the owner and steward pickers

Needs asset.govern or access.view, or an owner or steward role somewhere in the workspace. At most 20.

### Example

```ts
import {
  Configuration,
  GovernanceApi,
} from '@workspace/api-client';
import type { GovernanceControllerPrincipalsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GovernanceApi();

  const body = {
    // string (optional)
    q: q_example,
    // string | Comma-separated: user, group. Default both. (optional)
    kinds: kinds_example,
  } satisfies GovernanceControllerPrincipalsRequest;

  try {
    const data = await api.governanceControllerPrincipals(body);
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
| **q** | `string` |  | [Optional] [Defaults to `undefined`] |
| **kinds** | `string` | Comma-separated: user, group. Default both. | [Optional] [Defaults to `undefined`] |

### Return type

[**Array&lt;GovernancePrincipalDto&gt;**](GovernancePrincipalDto.md)

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


## governanceControllerRemoveAssetRole

> AssetGovernanceDto governanceControllerRemoveAssetRole(id, roleId)

End a role on an asset (kept as history)

### Example

```ts
import {
  Configuration,
  GovernanceApi,
} from '@workspace/api-client';
import type { GovernanceControllerRemoveAssetRoleRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GovernanceApi();

  const body = {
    // string
    id: id_example,
    // string
    roleId: roleId_example,
  } satisfies GovernanceControllerRemoveAssetRoleRequest;

  try {
    const data = await api.governanceControllerRemoveAssetRole(body);
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
| **roleId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**AssetGovernanceDto**](AssetGovernanceDto.md)

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


## governanceControllerRemoveColumn

> AssetColumnsDto governanceControllerRemoveColumn(id, name)

Forget what was said about one column

### Example

```ts
import {
  Configuration,
  GovernanceApi,
} from '@workspace/api-client';
import type { GovernanceControllerRemoveColumnRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GovernanceApi();

  const body = {
    // string
    id: id_example,
    // string
    name: name_example,
  } satisfies GovernanceControllerRemoveColumnRequest;

  try {
    const data = await api.governanceControllerRemoveColumn(body);
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
| **name** | `string` |  | [Defaults to `undefined`] |

### Return type

[**AssetColumnsDto**](AssetColumnsDto.md)

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


## governanceControllerRemoveSourceRole

> SourceGovernanceDto governanceControllerRemoveSourceRole(id, roleId)

End a role on a source (kept as history)

### Example

```ts
import {
  Configuration,
  GovernanceApi,
} from '@workspace/api-client';
import type { GovernanceControllerRemoveSourceRoleRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GovernanceApi();

  const body = {
    // string
    id: id_example,
    // string
    roleId: roleId_example,
  } satisfies GovernanceControllerRemoveSourceRoleRequest;

  try {
    const data = await api.governanceControllerRemoveSourceRole(body);
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
| **roleId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**SourceGovernanceDto**](SourceGovernanceDto.md)

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


## governanceControllerSourceGovernance

> SourceGovernanceDto governanceControllerSourceGovernance(id)

A source\&#39;s owners, stewards and custodians, and its coverage

### Example

```ts
import {
  Configuration,
  GovernanceApi,
} from '@workspace/api-client';
import type { GovernanceControllerSourceGovernanceRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GovernanceApi();

  const body = {
    // string
    id: id_example,
  } satisfies GovernanceControllerSourceGovernanceRequest;

  try {
    const data = await api.governanceControllerSourceGovernance(body);
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

[**SourceGovernanceDto**](SourceGovernanceDto.md)

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


## governanceControllerSummary

> GovernanceSummaryDto governanceControllerSummary(days)

How far the workspace is governed: coverage per source, what to govern first, yours

### Example

```ts
import {
  Configuration,
  GovernanceApi,
} from '@workspace/api-client';
import type { GovernanceControllerSummaryRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GovernanceApi();

  const body = {
    // string | 1–365, default 30 (optional)
    days: days_example,
  } satisfies GovernanceControllerSummaryRequest;

  try {
    const data = await api.governanceControllerSummary(body);
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
| **days** | `string` | 1–365, default 30 | [Optional] [Defaults to `undefined`] |

### Return type

[**GovernanceSummaryDto**](GovernanceSummaryDto.md)

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


## governanceControllerUpdateAssetGovernance

> AssetGovernanceDto governanceControllerUpdateAssetGovernance(id, updateAssetGovernanceDto)

Change an asset\&#39;s description, legal basis or lifecycle

Needs asset.govern, or the owner or steward role on the asset or its source. ACTIVE certifies the asset and needs an owner.

### Example

```ts
import {
  Configuration,
  GovernanceApi,
} from '@workspace/api-client';
import type { GovernanceControllerUpdateAssetGovernanceRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GovernanceApi();

  const body = {
    // string
    id: id_example,
    // UpdateAssetGovernanceDto
    updateAssetGovernanceDto: ...,
  } satisfies GovernanceControllerUpdateAssetGovernanceRequest;

  try {
    const data = await api.governanceControllerUpdateAssetGovernance(body);
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
| **updateAssetGovernanceDto** | [UpdateAssetGovernanceDto](UpdateAssetGovernanceDto.md) |  | |

### Return type

[**AssetGovernanceDto**](AssetGovernanceDto.md)

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


## governanceControllerUpdateColumn

> AssetColumnsDto governanceControllerUpdateColumn(id, name, updateAssetColumnDto)

Describe, classify or confirm one column

Needs asset.govern, or the owner or steward role on the asset or its source.

### Example

```ts
import {
  Configuration,
  GovernanceApi,
} from '@workspace/api-client';
import type { GovernanceControllerUpdateColumnRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GovernanceApi();

  const body = {
    // string
    id: id_example,
    // string
    name: name_example,
    // UpdateAssetColumnDto
    updateAssetColumnDto: ...,
  } satisfies GovernanceControllerUpdateColumnRequest;

  try {
    const data = await api.governanceControllerUpdateColumn(body);
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
| **name** | `string` |  | [Defaults to `undefined`] |
| **updateAssetColumnDto** | [UpdateAssetColumnDto](UpdateAssetColumnDto.md) |  | |

### Return type

[**AssetColumnsDto**](AssetColumnsDto.md)

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


## governanceControllerUsage

> AssetUsageDto governanceControllerUsage(id, days)

Who read and exported a table, per day, over the last days

### Example

```ts
import {
  Configuration,
  GovernanceApi,
} from '@workspace/api-client';
import type { GovernanceControllerUsageRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GovernanceApi();

  const body = {
    // string
    id: id_example,
    // string | 1–365, default 30 (optional)
    days: days_example,
  } satisfies GovernanceControllerUsageRequest;

  try {
    const data = await api.governanceControllerUsage(body);
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
| **days** | `string` | 1–365, default 30 | [Optional] [Defaults to `undefined`] |

### Return type

[**AssetUsageDto**](AssetUsageDto.md)

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

