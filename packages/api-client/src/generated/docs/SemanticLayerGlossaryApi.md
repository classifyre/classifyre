# SemanticLayerGlossaryApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**glossaryControllerCreate**](SemanticLayerGlossaryApi.md#glossarycontrollercreate) | **POST** /semantic/glossary | Create a new glossary term |
| [**glossaryControllerDelete**](SemanticLayerGlossaryApi.md#glossarycontrollerdelete) | **DELETE** /semantic/glossary/{id} | Delete a glossary term |
| [**glossaryControllerFindAll**](SemanticLayerGlossaryApi.md#glossarycontrollerfindall) | **GET** /semantic/glossary | List all glossary terms |
| [**glossaryControllerFindById**](SemanticLayerGlossaryApi.md#glossarycontrollerfindbyid) | **GET** /semantic/glossary/{id} | Get a glossary term by id |
| [**glossaryControllerPreview**](SemanticLayerGlossaryApi.md#glossarycontrollerpreview) | **POST** /semantic/glossary/{id}/preview | Preview the number of findings matching this glossary term |
| [**glossaryControllerUpdate**](SemanticLayerGlossaryApi.md#glossarycontrollerupdate) | **PUT** /semantic/glossary/{id} | Update a glossary term |



## glossaryControllerCreate

> glossaryControllerCreate(createGlossaryTermDto)

Create a new glossary term

### Example

```ts
import {
  Configuration,
  SemanticLayerGlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerCreateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticLayerGlossaryApi();

  const body = {
    // CreateGlossaryTermDto
    createGlossaryTermDto: ...,
  } satisfies GlossaryControllerCreateRequest;

  try {
    const data = await api.glossaryControllerCreate(body);
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
| **createGlossaryTermDto** | [CreateGlossaryTermDto](CreateGlossaryTermDto.md) |  | |

### Return type

`void` (Empty response body)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: Not defined


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## glossaryControllerDelete

> glossaryControllerDelete(id)

Delete a glossary term

### Example

```ts
import {
  Configuration,
  SemanticLayerGlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerDeleteRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticLayerGlossaryApi();

  const body = {
    // string
    id: id_example,
  } satisfies GlossaryControllerDeleteRequest;

  try {
    const data = await api.glossaryControllerDelete(body);
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


## glossaryControllerFindAll

> glossaryControllerFindAll(category, isActive)

List all glossary terms

### Example

```ts
import {
  Configuration,
  SemanticLayerGlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerFindAllRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticLayerGlossaryApi();

  const body = {
    // string (optional)
    category: category_example,
    // boolean (optional)
    isActive: true,
  } satisfies GlossaryControllerFindAllRequest;

  try {
    const data = await api.glossaryControllerFindAll(body);
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
| **category** | `string` |  | [Optional] [Defaults to `undefined`] |
| **isActive** | `boolean` |  | [Optional] [Defaults to `undefined`] |

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


## glossaryControllerFindById

> glossaryControllerFindById(id)

Get a glossary term by id

### Example

```ts
import {
  Configuration,
  SemanticLayerGlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerFindByIdRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticLayerGlossaryApi();

  const body = {
    // string
    id: id_example,
  } satisfies GlossaryControllerFindByIdRequest;

  try {
    const data = await api.glossaryControllerFindById(body);
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


## glossaryControllerPreview

> glossaryControllerPreview(id)

Preview the number of findings matching this glossary term

### Example

```ts
import {
  Configuration,
  SemanticLayerGlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerPreviewRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticLayerGlossaryApi();

  const body = {
    // string
    id: id_example,
  } satisfies GlossaryControllerPreviewRequest;

  try {
    const data = await api.glossaryControllerPreview(body);
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
| **201** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## glossaryControllerUpdate

> glossaryControllerUpdate(id, updateGlossaryTermDto)

Update a glossary term

### Example

```ts
import {
  Configuration,
  SemanticLayerGlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerUpdateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticLayerGlossaryApi();

  const body = {
    // string
    id: id_example,
    // UpdateGlossaryTermDto
    updateGlossaryTermDto: ...,
  } satisfies GlossaryControllerUpdateRequest;

  try {
    const data = await api.glossaryControllerUpdate(body);
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
| **updateGlossaryTermDto** | [UpdateGlossaryTermDto](UpdateGlossaryTermDto.md) |  | |

### Return type

`void` (Empty response body)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: Not defined


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

