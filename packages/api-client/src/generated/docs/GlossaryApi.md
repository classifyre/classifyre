# GlossaryApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**glossaryControllerList**](GlossaryApi.md#glossarycontrollerlist) | **GET** /glossary | List glossary terms |
| [**glossaryControllerLookup**](GlossaryApi.md#glossarycontrollerlookup) | **GET** /glossary/lookup | Resolve a name or alias to glossary terms (exact + semantic) |
| [**glossaryControllerRemove**](GlossaryApi.md#glossarycontrollerremove) | **DELETE** /glossary/{id} | Delete a glossary term |
| [**glossaryControllerUpsert**](GlossaryApi.md#glossarycontrollerupsert) | **POST** /glossary | Create or update a glossary term (operator) |
| [**glossaryControllerVerify**](GlossaryApi.md#glossarycontrollerverify) | **PATCH** /glossary/{id}/verify | Mark an agent-proposed term as verified |



## glossaryControllerList

> GlossaryListResponseDto glossaryControllerList(query, entityType, take, skip)

List glossary terms

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerListRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // string | Free-text filter over term, aliases and notes (ILIKE). (optional)
    query: query_example,
    // 'PERSON' | 'ORGANIZATION' | 'LOCATION' | 'REFERENCE' | 'TERM' | 'OTHER' (optional)
    entityType: entityType_example,
    // number (optional)
    take: 8.14,
    // number (optional)
    skip: 8.14,
  } satisfies GlossaryControllerListRequest;

  try {
    const data = await api.glossaryControllerList(body);
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
| **query** | `string` | Free-text filter over term, aliases and notes (ILIKE). | [Optional] [Defaults to `undefined`] |
| **entityType** | `PERSON`, `ORGANIZATION`, `LOCATION`, `REFERENCE`, `TERM`, `OTHER` |  | [Optional] [Defaults to `undefined`] [Enum: PERSON, ORGANIZATION, LOCATION, REFERENCE, TERM, OTHER] |
| **take** | `number` |  | [Optional] [Defaults to `25`] |
| **skip** | `number` |  | [Optional] [Defaults to `0`] |

### Return type

[**GlossaryListResponseDto**](GlossaryListResponseDto.md)

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


## glossaryControllerLookup

> Array&lt;GlossaryLookupHitDto&gt; glossaryControllerLookup(query, limit)

Resolve a name or alias to glossary terms (exact + semantic)

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerLookupRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // string | Name or alias to resolve.
    query: query_example,
    // number (optional)
    limit: 8.14,
  } satisfies GlossaryControllerLookupRequest;

  try {
    const data = await api.glossaryControllerLookup(body);
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
| **query** | `string` | Name or alias to resolve. | [Defaults to `undefined`] |
| **limit** | `number` |  | [Optional] [Defaults to `10`] |

### Return type

[**Array&lt;GlossaryLookupHitDto&gt;**](GlossaryLookupHitDto.md)

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


## glossaryControllerRemove

> DeleteGlossaryTermResponseDto glossaryControllerRemove(id)

Delete a glossary term

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerRemoveRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // string
    id: id_example,
  } satisfies GlossaryControllerRemoveRequest;

  try {
    const data = await api.glossaryControllerRemove(body);
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

[**DeleteGlossaryTermResponseDto**](DeleteGlossaryTermResponseDto.md)

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


## glossaryControllerUpsert

> UpsertGlossaryTermResponseDto glossaryControllerUpsert(upsertGlossaryTermDto)

Create or update a glossary term (operator)

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerUpsertRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // UpsertGlossaryTermDto
    upsertGlossaryTermDto: ...,
  } satisfies GlossaryControllerUpsertRequest;

  try {
    const data = await api.glossaryControllerUpsert(body);
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
| **upsertGlossaryTermDto** | [UpsertGlossaryTermDto](UpsertGlossaryTermDto.md) |  | |

### Return type

[**UpsertGlossaryTermResponseDto**](UpsertGlossaryTermResponseDto.md)

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


## glossaryControllerVerify

> GlossaryTermDto glossaryControllerVerify(id, verifyGlossaryTermDto)

Mark an agent-proposed term as verified

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerVerifyRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // string
    id: id_example,
    // VerifyGlossaryTermDto
    verifyGlossaryTermDto: ...,
  } satisfies GlossaryControllerVerifyRequest;

  try {
    const data = await api.glossaryControllerVerify(body);
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
| **verifyGlossaryTermDto** | [VerifyGlossaryTermDto](VerifyGlossaryTermDto.md) |  | |

### Return type

[**GlossaryTermDto**](GlossaryTermDto.md)

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

