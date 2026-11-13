# SQLConnectionsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**dataConnectionControllerAll**](SQLConnectionsApi.md#dataconnectioncontrollerall) | **GET** /data-connections/all | Everyone’s SQL connections (data.connection.manage) |
| [**dataConnectionControllerBlock**](SQLConnectionsApi.md#dataconnectioncontrollerblock) | **POST** /data-connections/{id}/blocks | Close a table or source you govern to this connection |
| [**dataConnectionControllerCreate**](SQLConnectionsApi.md#dataconnectioncontrollercreate) | **POST** /data-connections | Create a SQL connection of your own; the password is shown once |
| [**dataConnectionControllerEndpoint**](SQLConnectionsApi.md#dataconnectioncontrollerendpoint) | **GET** /data-connections/endpoint | Where tools connect: host, port, database, TLS |
| [**dataConnectionControllerForAsset**](SQLConnectionsApi.md#dataconnectioncontrollerforasset) | **GET** /assets/{id}/data-connections | SQL connections that read, name or are blocked on a table |
| [**dataConnectionControllerForSource**](SQLConnectionsApi.md#dataconnectioncontrollerforsource) | **GET** /sources/{id}/data-connections | SQL connections that read, name or are blocked on a source |
| [**dataConnectionControllerIssue**](SQLConnectionsApi.md#dataconnectioncontrollerissue) | **POST** /data-connections/issue | Give someone a SQL connection; they reveal its password themselves |
| [**dataConnectionControllerMine**](SQLConnectionsApi.md#dataconnectioncontrollermine) | **GET** /data-connections | Your SQL connections |
| [**dataConnectionControllerPassword**](SQLConnectionsApi.md#dataconnectioncontrollerpassword) | **POST** /data-connections/{id}/password | Reveal (first time) or replace the password of your own connection |
| [**dataConnectionControllerRevoke**](SQLConnectionsApi.md#dataconnectioncontrollerrevoke) | **POST** /data-connections/{id}/revoke | Revoke a SQL connection (its person or a manager) |
| [**dataConnectionControllerUnblock**](SQLConnectionsApi.md#dataconnectioncontrollerunblock) | **DELETE** /data-connections/{id}/blocks/{blockId} | Lift a block |



## dataConnectionControllerAll

> DataConnectionListDto dataConnectionControllerAll()

Everyone’s SQL connections (data.connection.manage)

### Example

```ts
import {
  Configuration,
  SQLConnectionsApi,
} from '@workspace/api-client';
import type { DataConnectionControllerAllRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SQLConnectionsApi();

  try {
    const data = await api.dataConnectionControllerAll();
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

[**DataConnectionListDto**](DataConnectionListDto.md)

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


## dataConnectionControllerBlock

> DataConnectionDto dataConnectionControllerBlock(id, blockDataConnectionDto)

Close a table or source you govern to this connection

### Example

```ts
import {
  Configuration,
  SQLConnectionsApi,
} from '@workspace/api-client';
import type { DataConnectionControllerBlockRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SQLConnectionsApi();

  const body = {
    // string
    id: id_example,
    // BlockDataConnectionDto
    blockDataConnectionDto: ...,
  } satisfies DataConnectionControllerBlockRequest;

  try {
    const data = await api.dataConnectionControllerBlock(body);
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
| **blockDataConnectionDto** | [BlockDataConnectionDto](BlockDataConnectionDto.md) |  | |

### Return type

[**DataConnectionDto**](DataConnectionDto.md)

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


## dataConnectionControllerCreate

> DataConnectionSecretDto dataConnectionControllerCreate(createDataConnectionDto)

Create a SQL connection of your own; the password is shown once

### Example

```ts
import {
  Configuration,
  SQLConnectionsApi,
} from '@workspace/api-client';
import type { DataConnectionControllerCreateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SQLConnectionsApi();

  const body = {
    // CreateDataConnectionDto
    createDataConnectionDto: ...,
  } satisfies DataConnectionControllerCreateRequest;

  try {
    const data = await api.dataConnectionControllerCreate(body);
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
| **createDataConnectionDto** | [CreateDataConnectionDto](CreateDataConnectionDto.md) |  | |

### Return type

[**DataConnectionSecretDto**](DataConnectionSecretDto.md)

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


## dataConnectionControllerEndpoint

> DataConnectionEndpointDto dataConnectionControllerEndpoint()

Where tools connect: host, port, database, TLS

### Example

```ts
import {
  Configuration,
  SQLConnectionsApi,
} from '@workspace/api-client';
import type { DataConnectionControllerEndpointRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SQLConnectionsApi();

  try {
    const data = await api.dataConnectionControllerEndpoint();
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

[**DataConnectionEndpointDto**](DataConnectionEndpointDto.md)

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


## dataConnectionControllerForAsset

> DataConnectionListDto dataConnectionControllerForAsset(id)

SQL connections that read, name or are blocked on a table

### Example

```ts
import {
  Configuration,
  SQLConnectionsApi,
} from '@workspace/api-client';
import type { DataConnectionControllerForAssetRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SQLConnectionsApi();

  const body = {
    // string
    id: id_example,
  } satisfies DataConnectionControllerForAssetRequest;

  try {
    const data = await api.dataConnectionControllerForAsset(body);
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

[**DataConnectionListDto**](DataConnectionListDto.md)

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


## dataConnectionControllerForSource

> DataConnectionListDto dataConnectionControllerForSource(id)

SQL connections that read, name or are blocked on a source

### Example

```ts
import {
  Configuration,
  SQLConnectionsApi,
} from '@workspace/api-client';
import type { DataConnectionControllerForSourceRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SQLConnectionsApi();

  const body = {
    // string
    id: id_example,
  } satisfies DataConnectionControllerForSourceRequest;

  try {
    const data = await api.dataConnectionControllerForSource(body);
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

[**DataConnectionListDto**](DataConnectionListDto.md)

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


## dataConnectionControllerIssue

> DataConnectionDto dataConnectionControllerIssue(issueDataConnectionDto)

Give someone a SQL connection; they reveal its password themselves

### Example

```ts
import {
  Configuration,
  SQLConnectionsApi,
} from '@workspace/api-client';
import type { DataConnectionControllerIssueRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SQLConnectionsApi();

  const body = {
    // IssueDataConnectionDto
    issueDataConnectionDto: ...,
  } satisfies DataConnectionControllerIssueRequest;

  try {
    const data = await api.dataConnectionControllerIssue(body);
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
| **issueDataConnectionDto** | [IssueDataConnectionDto](IssueDataConnectionDto.md) |  | |

### Return type

[**DataConnectionDto**](DataConnectionDto.md)

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


## dataConnectionControllerMine

> DataConnectionListDto dataConnectionControllerMine()

Your SQL connections

### Example

```ts
import {
  Configuration,
  SQLConnectionsApi,
} from '@workspace/api-client';
import type { DataConnectionControllerMineRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SQLConnectionsApi();

  try {
    const data = await api.dataConnectionControllerMine();
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

[**DataConnectionListDto**](DataConnectionListDto.md)

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


## dataConnectionControllerPassword

> DataConnectionSecretDto dataConnectionControllerPassword(id)

Reveal (first time) or replace the password of your own connection

### Example

```ts
import {
  Configuration,
  SQLConnectionsApi,
} from '@workspace/api-client';
import type { DataConnectionControllerPasswordRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SQLConnectionsApi();

  const body = {
    // string
    id: id_example,
  } satisfies DataConnectionControllerPasswordRequest;

  try {
    const data = await api.dataConnectionControllerPassword(body);
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

[**DataConnectionSecretDto**](DataConnectionSecretDto.md)

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


## dataConnectionControllerRevoke

> DataConnectionDto dataConnectionControllerRevoke(id, revokeDataConnectionDto)

Revoke a SQL connection (its person or a manager)

### Example

```ts
import {
  Configuration,
  SQLConnectionsApi,
} from '@workspace/api-client';
import type { DataConnectionControllerRevokeRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SQLConnectionsApi();

  const body = {
    // string
    id: id_example,
    // RevokeDataConnectionDto
    revokeDataConnectionDto: ...,
  } satisfies DataConnectionControllerRevokeRequest;

  try {
    const data = await api.dataConnectionControllerRevoke(body);
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
| **revokeDataConnectionDto** | [RevokeDataConnectionDto](RevokeDataConnectionDto.md) |  | |

### Return type

[**DataConnectionDto**](DataConnectionDto.md)

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


## dataConnectionControllerUnblock

> DataConnectionDto dataConnectionControllerUnblock(id, blockId)

Lift a block

### Example

```ts
import {
  Configuration,
  SQLConnectionsApi,
} from '@workspace/api-client';
import type { DataConnectionControllerUnblockRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SQLConnectionsApi();

  const body = {
    // string
    id: id_example,
    // string
    blockId: blockId_example,
  } satisfies DataConnectionControllerUnblockRequest;

  try {
    const data = await api.dataConnectionControllerUnblock(body);
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
| **blockId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**DataConnectionDto**](DataConnectionDto.md)

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

