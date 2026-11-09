# DataQueryApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**dataQueryControllerCancel**](DataQueryApi.md#dataquerycontrollercancel) | **POST** /query-runs/{id}/cancel | Stop one of your queries |
| [**dataQueryControllerCreate**](DataQueryApi.md#dataquerycontrollercreate) | **POST** /query-runs | Run one SELECT; poll the run for its status |
| [**dataQueryControllerGet**](DataQueryApi.md#dataquerycontrollerget) | **GET** /query-runs/{id} | One of your queries |
| [**dataQueryControllerGetCatalog**](DataQueryApi.md#dataquerycontrollergetcatalog) | **GET** /data-query/catalog | The tables you can query with SQL, and those you could with access |
| [**dataQueryControllerGetSettings**](DataQueryApi.md#dataquerycontrollergetsettings) | **GET** /data-query/settings | Whether this workspace answers SQL, and its limits |
| [**dataQueryControllerList**](DataQueryApi.md#dataquerycontrollerlist) | **GET** /query-runs | Your recent queries in this workspace |
| [**dataQueryControllerReceive**](DataQueryApi.md#dataquerycontrollerreceive) | **POST** /query-runs/{id}/result | Internal: a query job posts its result here |
| [**dataQueryControllerResult**](DataQueryApi.md#dataquerycontrollerresult) | **GET** /query-runs/{id}/result | The rows of a finished query (Arrow IPC stream), or its exported file |
| [**dataQueryControllerUpdateSettings**](DataQueryApi.md#dataquerycontrollerupdatesettings) | **PUT** /data-query/settings | Set the limits of SQL queries in this workspace |



## dataQueryControllerCancel

> QueryRunDto dataQueryControllerCancel(id)

Stop one of your queries

### Example

```ts
import {
  Configuration,
  DataQueryApi,
} from '@workspace/api-client';
import type { DataQueryControllerCancelRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataQueryApi();

  const body = {
    // string
    id: id_example,
  } satisfies DataQueryControllerCancelRequest;

  try {
    const data = await api.dataQueryControllerCancel(body);
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

[**QueryRunDto**](QueryRunDto.md)

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


## dataQueryControllerCreate

> QueryRunDto dataQueryControllerCreate(createQueryRunDto)

Run one SELECT; poll the run for its status

Runs as a short-lived job. Only tables you may query exist for the query; name them &#x60;&lt;source&gt;.&lt;schema&gt;.&lt;table&gt;&#x60; as the catalog lists them.

### Example

```ts
import {
  Configuration,
  DataQueryApi,
} from '@workspace/api-client';
import type { DataQueryControllerCreateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataQueryApi();

  const body = {
    // CreateQueryRunDto
    createQueryRunDto: ...,
  } satisfies DataQueryControllerCreateRequest;

  try {
    const data = await api.dataQueryControllerCreate(body);
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
| **createQueryRunDto** | [CreateQueryRunDto](CreateQueryRunDto.md) |  | |

### Return type

[**QueryRunDto**](QueryRunDto.md)

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


## dataQueryControllerGet

> QueryRunDto dataQueryControllerGet(id)

One of your queries

### Example

```ts
import {
  Configuration,
  DataQueryApi,
} from '@workspace/api-client';
import type { DataQueryControllerGetRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataQueryApi();

  const body = {
    // string
    id: id_example,
  } satisfies DataQueryControllerGetRequest;

  try {
    const data = await api.dataQueryControllerGet(body);
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

[**QueryRunDto**](QueryRunDto.md)

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


## dataQueryControllerGetCatalog

> QueryCatalogDto dataQueryControllerGetCatalog()

The tables you can query with SQL, and those you could with access

### Example

```ts
import {
  Configuration,
  DataQueryApi,
} from '@workspace/api-client';
import type { DataQueryControllerGetCatalogRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataQueryApi();

  try {
    const data = await api.dataQueryControllerGetCatalog();
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

[**QueryCatalogDto**](QueryCatalogDto.md)

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


## dataQueryControllerGetSettings

> DataQuerySettingsDto dataQueryControllerGetSettings()

Whether this workspace answers SQL, and its limits

### Example

```ts
import {
  Configuration,
  DataQueryApi,
} from '@workspace/api-client';
import type { DataQueryControllerGetSettingsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataQueryApi();

  try {
    const data = await api.dataQueryControllerGetSettings();
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

[**DataQuerySettingsDto**](DataQuerySettingsDto.md)

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


## dataQueryControllerList

> Array&lt;QueryRunDto&gt; dataQueryControllerList(limit)

Your recent queries in this workspace

### Example

```ts
import {
  Configuration,
  DataQueryApi,
} from '@workspace/api-client';
import type { DataQueryControllerListRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataQueryApi();

  const body = {
    // number (optional)
    limit: 8.14,
  } satisfies DataQueryControllerListRequest;

  try {
    const data = await api.dataQueryControllerList(body);
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
| **limit** | `number` |  | [Optional] [Defaults to `undefined`] |

### Return type

[**Array&lt;QueryRunDto&gt;**](QueryRunDto.md)

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


## dataQueryControllerReceive

> dataQueryControllerReceive(id, xQueryRunToken, xQueryRunMeta)

Internal: a query job posts its result here

### Example

```ts
import {
  Configuration,
  DataQueryApi,
} from '@workspace/api-client';
import type { DataQueryControllerReceiveRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataQueryApi();

  const body = {
    // string
    id: id_example,
    // string
    xQueryRunToken: xQueryRunToken_example,
    // string
    xQueryRunMeta: xQueryRunMeta_example,
  } satisfies DataQueryControllerReceiveRequest;

  try {
    const data = await api.dataQueryControllerReceive(body);
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
| **xQueryRunToken** | `string` |  | [Defaults to `undefined`] |
| **xQueryRunMeta** | `string` |  | [Defaults to `undefined`] |

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


## dataQueryControllerResult

> dataQueryControllerResult(id)

The rows of a finished query (Arrow IPC stream), or its exported file

### Example

```ts
import {
  Configuration,
  DataQueryApi,
} from '@workspace/api-client';
import type { DataQueryControllerResultRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataQueryApi();

  const body = {
    // string
    id: id_example,
  } satisfies DataQueryControllerResultRequest;

  try {
    const data = await api.dataQueryControllerResult(body);
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
| **200** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## dataQueryControllerUpdateSettings

> DataQuerySettingsDto dataQueryControllerUpdateSettings(updateDataQuerySettingsDto)

Set the limits of SQL queries in this workspace

### Example

```ts
import {
  Configuration,
  DataQueryApi,
} from '@workspace/api-client';
import type { DataQueryControllerUpdateSettingsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataQueryApi();

  const body = {
    // UpdateDataQuerySettingsDto
    updateDataQuerySettingsDto: ...,
  } satisfies DataQueryControllerUpdateSettingsRequest;

  try {
    const data = await api.dataQueryControllerUpdateSettings(body);
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
| **updateDataQuerySettingsDto** | [UpdateDataQuerySettingsDto](UpdateDataQuerySettingsDto.md) |  | |

### Return type

[**DataQuerySettingsDto**](DataQuerySettingsDto.md)

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

