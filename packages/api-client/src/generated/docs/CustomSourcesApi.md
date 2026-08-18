# CustomSourcesApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**customSourcesControllerGetNotebook**](CustomSourcesApi.md#customsourcescontrollergetnotebook) | **GET** /sources/{sourceId}/notebook | Read a custom source\&#39;s notebook (the newest revision by default) |
| [**customSourcesControllerGetSession**](CustomSourcesApi.md#customsourcescontrollergetsession) | **GET** /sources/{sourceId}/session | Current notebook editing session, if any |
| [**customSourcesControllerListRevisions**](CustomSourcesApi.md#customsourcescontrollerlistrevisions) | **GET** /sources/{sourceId}/notebook/revisions | List saved notebook revisions, newest first |
| [**customSourcesControllerSaveNotebook**](CustomSourcesApi.md#customsourcescontrollersavenotebook) | **PUT** /sources/{sourceId}/notebook | Save a new notebook revision |
| [**customSourcesControllerStartSession**](CustomSourcesApi.md#customsourcescontrollerstartsession) | **POST** /sources/{sourceId}/session | Start a notebook editing session (returns the running one if any) |
| [**customSourcesControllerStopSession**](CustomSourcesApi.md#customsourcescontrollerstopsession) | **DELETE** /sources/{sourceId}/session | Stop the notebook editing session |



## customSourcesControllerGetNotebook

> NotebookDto customSourcesControllerGetNotebook(sourceId, revision)

Read a custom source\&#39;s notebook (the newest revision by default)

### Example

```ts
import {
  Configuration,
  CustomSourcesApi,
} from '@workspace/api-client';
import type { CustomSourcesControllerGetNotebookRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomSourcesApi();

  const body = {
    // string
    sourceId: sourceId_example,
    // string | Read a specific revision instead of the newest (optional)
    revision: revision_example,
  } satisfies CustomSourcesControllerGetNotebookRequest;

  try {
    const data = await api.customSourcesControllerGetNotebook(body);
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
| **sourceId** | `string` |  | [Defaults to `undefined`] |
| **revision** | `string` | Read a specific revision instead of the newest | [Optional] [Defaults to `undefined`] |

### Return type

[**NotebookDto**](NotebookDto.md)

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


## customSourcesControllerGetSession

> NotebookSessionDto customSourcesControllerGetSession(sourceId)

Current notebook editing session, if any

### Example

```ts
import {
  Configuration,
  CustomSourcesApi,
} from '@workspace/api-client';
import type { CustomSourcesControllerGetSessionRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomSourcesApi();

  const body = {
    // string
    sourceId: sourceId_example,
  } satisfies CustomSourcesControllerGetSessionRequest;

  try {
    const data = await api.customSourcesControllerGetSession(body);
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
| **sourceId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**NotebookSessionDto**](NotebookSessionDto.md)

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


## customSourcesControllerListRevisions

> Array&lt;NotebookRevisionDto&gt; customSourcesControllerListRevisions(sourceId, limit)

List saved notebook revisions, newest first

### Example

```ts
import {
  Configuration,
  CustomSourcesApi,
} from '@workspace/api-client';
import type { CustomSourcesControllerListRevisionsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomSourcesApi();

  const body = {
    // string
    sourceId: sourceId_example,
    // string (optional)
    limit: limit_example,
  } satisfies CustomSourcesControllerListRevisionsRequest;

  try {
    const data = await api.customSourcesControllerListRevisions(body);
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
| **sourceId** | `string` |  | [Defaults to `undefined`] |
| **limit** | `string` |  | [Optional] [Defaults to `undefined`] |

### Return type

[**Array&lt;NotebookRevisionDto&gt;**](NotebookRevisionDto.md)

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


## customSourcesControllerSaveNotebook

> SaveNotebookResponseDto customSourcesControllerSaveNotebook(sourceId, saveNotebookDto)

Save a new notebook revision

### Example

```ts
import {
  Configuration,
  CustomSourcesApi,
} from '@workspace/api-client';
import type { CustomSourcesControllerSaveNotebookRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomSourcesApi();

  const body = {
    // string
    sourceId: sourceId_example,
    // SaveNotebookDto
    saveNotebookDto: ...,
  } satisfies CustomSourcesControllerSaveNotebookRequest;

  try {
    const data = await api.customSourcesControllerSaveNotebook(body);
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
| **sourceId** | `string` |  | [Defaults to `undefined`] |
| **saveNotebookDto** | [SaveNotebookDto](SaveNotebookDto.md) |  | |

### Return type

[**SaveNotebookResponseDto**](SaveNotebookResponseDto.md)

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


## customSourcesControllerStartSession

> NotebookSessionDto customSourcesControllerStartSession(sourceId)

Start a notebook editing session (returns the running one if any)

### Example

```ts
import {
  Configuration,
  CustomSourcesApi,
} from '@workspace/api-client';
import type { CustomSourcesControllerStartSessionRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomSourcesApi();

  const body = {
    // string
    sourceId: sourceId_example,
  } satisfies CustomSourcesControllerStartSessionRequest;

  try {
    const data = await api.customSourcesControllerStartSession(body);
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
| **sourceId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**NotebookSessionDto**](NotebookSessionDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## customSourcesControllerStopSession

> customSourcesControllerStopSession(sourceId)

Stop the notebook editing session

### Example

```ts
import {
  Configuration,
  CustomSourcesApi,
} from '@workspace/api-client';
import type { CustomSourcesControllerStopSessionRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomSourcesApi();

  const body = {
    // string
    sourceId: sourceId_example,
  } satisfies CustomSourcesControllerStopSessionRequest;

  try {
    const data = await api.customSourcesControllerStopSession(body);
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
| **sourceId** | `string` |  | [Defaults to `undefined`] |

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

