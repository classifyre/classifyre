# CasesApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**casesControllerAddEvidence**](CasesApi.md#casescontrolleraddevidence) | **POST** /cases/{id}/evidence | Attach an asset or finding to the case as evidence |
| [**casesControllerCreate**](CasesApi.md#casescontrollercreate) | **POST** /cases | Create an investigation case |
| [**casesControllerFindOne**](CasesApi.md#casescontrollerfindone) | **GET** /cases/{id} | Get a case with hydrated evidence |
| [**casesControllerGraph**](CasesApi.md#casescontrollergraph) | **GET** /cases/{id}/graph | Get the evidence neighbourhood graph for a case |
| [**casesControllerList**](CasesApi.md#casescontrollerlist) | **GET** /cases | List investigation cases |
| [**casesControllerRemove**](CasesApi.md#casescontrollerremove) | **DELETE** /cases/{id} | Delete a case |
| [**casesControllerRemoveEvidence**](CasesApi.md#casescontrollerremoveevidence) | **DELETE** /cases/{id}/evidence/{evidenceId} | Remove evidence from the case |
| [**casesControllerUpdate**](CasesApi.md#casescontrollerupdate) | **PATCH** /cases/{id} | Update a case |



## casesControllerAddEvidence

> CaseEvidenceDto casesControllerAddEvidence(id, addEvidenceDto)

Attach an asset or finding to the case as evidence

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CasesControllerAddEvidenceRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    id: id_example,
    // AddEvidenceDto
    addEvidenceDto: ...,
  } satisfies CasesControllerAddEvidenceRequest;

  try {
    const data = await api.casesControllerAddEvidence(body);
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
| **addEvidenceDto** | [AddEvidenceDto](AddEvidenceDto.md) |  | |

### Return type

[**CaseEvidenceDto**](CaseEvidenceDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## casesControllerCreate

> CaseResponseDto casesControllerCreate(createCaseDto)

Create an investigation case

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CasesControllerCreateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // CreateCaseDto
    createCaseDto: ...,
  } satisfies CasesControllerCreateRequest;

  try {
    const data = await api.casesControllerCreate(body);
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
| **createCaseDto** | [CreateCaseDto](CreateCaseDto.md) |  | |

### Return type

[**CaseResponseDto**](CaseResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## casesControllerFindOne

> CaseResponseDto casesControllerFindOne(id)

Get a case with hydrated evidence

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CasesControllerFindOneRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    id: id_example,
  } satisfies CasesControllerFindOneRequest;

  try {
    const data = await api.casesControllerFindOne(body);
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

[**CaseResponseDto**](CaseResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** |  |  -  |
| **404** | Case not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## casesControllerGraph

> GraphResponseDto casesControllerGraph(id, depth)

Get the evidence neighbourhood graph for a case

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CasesControllerGraphRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    id: id_example,
    // number (optional)
    depth: 8.14,
  } satisfies CasesControllerGraphRequest;

  try {
    const data = await api.casesControllerGraph(body);
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
| **depth** | `number` |  | [Optional] [Defaults to `undefined`] |

### Return type

[**GraphResponseDto**](GraphResponseDto.md)

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


## casesControllerList

> CaseListResponseDto casesControllerList(search, status, severity, skip, limit)

List investigation cases

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CasesControllerListRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string (optional)
    search: search_example,
    // Array<'OPEN' | 'IN_PROGRESS' | 'CLOSED' | 'ARCHIVED'> (optional)
    status: ...,
    // Array<'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'> (optional)
    severity: ...,
    // number (optional)
    skip: 8.14,
    // number (optional)
    limit: 8.14,
  } satisfies CasesControllerListRequest;

  try {
    const data = await api.casesControllerList(body);
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
| **search** | `string` |  | [Optional] [Defaults to `undefined`] |
| **status** | `OPEN`, `IN_PROGRESS`, `CLOSED`, `ARCHIVED` |  | [Optional] [Enum: OPEN, IN_PROGRESS, CLOSED, ARCHIVED] |
| **severity** | `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFO` |  | [Optional] [Enum: CRITICAL, HIGH, MEDIUM, LOW, INFO] |
| **skip** | `number` |  | [Optional] [Defaults to `0`] |
| **limit** | `number` |  | [Optional] [Defaults to `50`] |

### Return type

[**CaseListResponseDto**](CaseListResponseDto.md)

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


## casesControllerRemove

> casesControllerRemove(id)

Delete a case

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CasesControllerRemoveRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    id: id_example,
  } satisfies CasesControllerRemoveRequest;

  try {
    const data = await api.casesControllerRemove(body);
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


## casesControllerRemoveEvidence

> casesControllerRemoveEvidence(id, evidenceId)

Remove evidence from the case

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CasesControllerRemoveEvidenceRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    id: id_example,
    // string
    evidenceId: evidenceId_example,
  } satisfies CasesControllerRemoveEvidenceRequest;

  try {
    const data = await api.casesControllerRemoveEvidence(body);
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
| **evidenceId** | `string` |  | [Defaults to `undefined`] |

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


## casesControllerUpdate

> CaseResponseDto casesControllerUpdate(id, updateCaseDto)

Update a case

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CasesControllerUpdateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    id: id_example,
    // UpdateCaseDto
    updateCaseDto: ...,
  } satisfies CasesControllerUpdateRequest;

  try {
    const data = await api.casesControllerUpdate(body);
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
| **updateCaseDto** | [UpdateCaseDto](UpdateCaseDto.md) |  | |

### Return type

[**CaseResponseDto**](CaseResponseDto.md)

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

