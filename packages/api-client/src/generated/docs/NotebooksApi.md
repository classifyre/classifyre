# NotebooksApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**notebookControllerCancel**](NotebooksApi.md#notebookcontrollercancel) | **POST** /notebook/executions/{executionId}/cancel | Stop a running execution |
| [**notebookControllerCreateExecution**](NotebooksApi.md#notebookcontrollercreateexecution) | **POST** /sources/{sourceId}/notebook/executions | Start a notebook execution |
| [**notebookControllerExportPython**](NotebooksApi.md#notebookcontrollerexportpython) | **GET** /sources/{sourceId}/notebook/export | The notebook as an ordinary Python module |
| [**notebookControllerGet**](NotebooksApi.md#notebookcontrollerget) | **GET** /sources/{sourceId}/notebook | Read a source\&#39;s notebook |
| [**notebookControllerGetExecution**](NotebooksApi.md#notebookcontrollergetexecution) | **GET** /notebook/executions/{executionId} | Poll one execution |
| [**notebookControllerListExecutions**](NotebooksApi.md#notebookcontrollerlistexecutions) | **GET** /sources/{sourceId}/notebook/executions | Recent executions for a source |
| [**notebookControllerScaffold**](NotebooksApi.md#notebookcontrollerscaffold) | **GET** /notebooks/scaffold | The starter cells and the functions a notebook must define |
| [**notebookControllerTemplates**](NotebooksApi.md#notebookcontrollertemplates) | **GET** /notebooks/templates | Worked notebooks an author can start from or borrow cells out of |
| [**notebookControllerUpdate**](NotebooksApi.md#notebookcontrollerupdate) | **PUT** /sources/{sourceId}/notebook | Save a notebook |



## notebookControllerCancel

> notebookControllerCancel(executionId)

Stop a running execution

Ends the process or deletes the Job. A cell that ignores ctx.should_abort is stopped this way and no other.

### Example

```ts
import {
  Configuration,
  NotebooksApi,
} from '@workspace/api-client';
import type { NotebookControllerCancelRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new NotebooksApi();

  const body = {
    // string
    executionId: executionId_example,
  } satisfies NotebookControllerCancelRequest;

  try {
    const data = await api.notebookControllerCancel(body);
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
| **executionId** | `string` |  | [Defaults to `undefined`] |

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


## notebookControllerCreateExecution

> NotebookExecutionDto notebookControllerCreateExecution(sourceId, createNotebookExecutionDto)

Start a notebook execution

Returns immediately; poll GET /notebook/executions/:id for the result.

### Example

```ts
import {
  Configuration,
  NotebooksApi,
} from '@workspace/api-client';
import type { NotebookControllerCreateExecutionRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new NotebooksApi();

  const body = {
    // string
    sourceId: sourceId_example,
    // CreateNotebookExecutionDto
    createNotebookExecutionDto: ...,
  } satisfies NotebookControllerCreateExecutionRequest;

  try {
    const data = await api.notebookControllerCreateExecution(body);
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
| **createNotebookExecutionDto** | [CreateNotebookExecutionDto](CreateNotebookExecutionDto.md) |  | |

### Return type

[**NotebookExecutionDto**](NotebookExecutionDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **202** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## notebookControllerExportPython

> notebookControllerExportPython(sourceId, scope)

The notebook as an ordinary Python module

Uses the &#x60;# %%&#x60; convention, so the result runs under plain &#x60;python workflow.py&#x60; with no notebook runtime.

### Example

```ts
import {
  Configuration,
  NotebooksApi,
} from '@workspace/api-client';
import type { NotebookControllerExportPythonRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new NotebooksApi();

  const body = {
    // string
    sourceId: sourceId_example,
    // 'connector' | 'augmentation' (optional)
    scope: scope_example,
  } satisfies NotebookControllerExportPythonRequest;

  try {
    const data = await api.notebookControllerExportPython(body);
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
| **scope** | `connector`, `augmentation` |  | [Optional] [Defaults to `undefined`] [Enum: connector, augmentation] |

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


## notebookControllerGet

> NotebookDto notebookControllerGet(sourceId, scope)

Read a source\&#39;s notebook

### Example

```ts
import {
  Configuration,
  NotebooksApi,
} from '@workspace/api-client';
import type { NotebookControllerGetRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new NotebooksApi();

  const body = {
    // string
    sourceId: sourceId_example,
    // 'connector' | 'augmentation' (optional)
    scope: scope_example,
  } satisfies NotebookControllerGetRequest;

  try {
    const data = await api.notebookControllerGet(body);
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
| **scope** | `connector`, `augmentation` |  | [Optional] [Defaults to `undefined`] [Enum: connector, augmentation] |

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


## notebookControllerGetExecution

> NotebookExecutionDto notebookControllerGetExecution(executionId)

Poll one execution

### Example

```ts
import {
  Configuration,
  NotebooksApi,
} from '@workspace/api-client';
import type { NotebookControllerGetExecutionRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new NotebooksApi();

  const body = {
    // string
    executionId: executionId_example,
  } satisfies NotebookControllerGetExecutionRequest;

  try {
    const data = await api.notebookControllerGetExecution(body);
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
| **executionId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**NotebookExecutionDto**](NotebookExecutionDto.md)

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


## notebookControllerListExecutions

> Array&lt;NotebookExecutionDto&gt; notebookControllerListExecutions(sourceId, limit)

Recent executions for a source

### Example

```ts
import {
  Configuration,
  NotebooksApi,
} from '@workspace/api-client';
import type { NotebookControllerListExecutionsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new NotebooksApi();

  const body = {
    // string
    sourceId: sourceId_example,
    // string
    limit: limit_example,
  } satisfies NotebookControllerListExecutionsRequest;

  try {
    const data = await api.notebookControllerListExecutions(body);
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
| **limit** | `string` |  | [Defaults to `undefined`] |

### Return type

[**Array&lt;NotebookExecutionDto&gt;**](NotebookExecutionDto.md)

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


## notebookControllerScaffold

> NotebookScaffoldDto notebookControllerScaffold(scope)

The starter cells and the functions a notebook must define

### Example

```ts
import {
  Configuration,
  NotebooksApi,
} from '@workspace/api-client';
import type { NotebookControllerScaffoldRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new NotebooksApi();

  const body = {
    // 'connector' | 'augmentation' (optional)
    scope: scope_example,
  } satisfies NotebookControllerScaffoldRequest;

  try {
    const data = await api.notebookControllerScaffold(body);
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
| **scope** | `connector`, `augmentation` |  | [Optional] [Defaults to `undefined`] [Enum: connector, augmentation] |

### Return type

[**NotebookScaffoldDto**](NotebookScaffoldDto.md)

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


## notebookControllerTemplates

> Array&lt;NotebookTemplateDto&gt; notebookControllerTemplates(scope)

Worked notebooks an author can start from or borrow cells out of

### Example

```ts
import {
  Configuration,
  NotebooksApi,
} from '@workspace/api-client';
import type { NotebookControllerTemplatesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new NotebooksApi();

  const body = {
    // 'connector' | 'augmentation' (optional)
    scope: scope_example,
  } satisfies NotebookControllerTemplatesRequest;

  try {
    const data = await api.notebookControllerTemplates(body);
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
| **scope** | `connector`, `augmentation` |  | [Optional] [Defaults to `undefined`] [Enum: connector, augmentation] |

### Return type

[**Array&lt;NotebookTemplateDto&gt;**](NotebookTemplateDto.md)

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


## notebookControllerUpdate

> UpdateNotebookResponseDto notebookControllerUpdate(sourceId, updateNotebookDto, scope)

Save a notebook

Rejected with 409 when someone else saved since baseRevision, so two editors cannot silently overwrite each other.

### Example

```ts
import {
  Configuration,
  NotebooksApi,
} from '@workspace/api-client';
import type { NotebookControllerUpdateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new NotebooksApi();

  const body = {
    // string
    sourceId: sourceId_example,
    // UpdateNotebookDto
    updateNotebookDto: ...,
    // 'connector' | 'augmentation' (optional)
    scope: scope_example,
  } satisfies NotebookControllerUpdateRequest;

  try {
    const data = await api.notebookControllerUpdate(body);
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
| **updateNotebookDto** | [UpdateNotebookDto](UpdateNotebookDto.md) |  | |
| **scope** | `connector`, `augmentation` |  | [Optional] [Defaults to `undefined`] [Enum: connector, augmentation] |

### Return type

[**UpdateNotebookResponseDto**](UpdateNotebookResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** |  |  -  |
| **409** | The notebook has moved on |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

