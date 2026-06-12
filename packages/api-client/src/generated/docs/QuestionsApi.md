# QuestionsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**questionsControllerCreate**](QuestionsApi.md#questionscontrollercreate) | **POST** /questions | Create a question (a saved query) and seed its matches |
| [**questionsControllerFindOne**](QuestionsApi.md#questionscontrollerfindone) | **GET** /questions/{id} | Get a question |
| [**questionsControllerList**](QuestionsApi.md#questionscontrollerlist) | **GET** /questions | List questions (with match counts) |
| [**questionsControllerListMatches**](QuestionsApi.md#questionscontrollerlistmatches) | **GET** /questions/{id}/matches | List the findings currently matching this question |
| [**questionsControllerMarkSeen**](QuestionsApi.md#questionscontrollermarkseen) | **POST** /questions/{id}/seen | Mark the current matches as seen (clears the \&quot;new\&quot; badge) |
| [**questionsControllerMatchOptions**](QuestionsApi.md#questionscontrollermatchoptions) | **GET** /questions/match-options | Sources, custom detectors and distinct finding types for the matcher form |
| [**questionsControllerPreview**](QuestionsApi.md#questionscontrollerpreview) | **POST** /questions/preview | Preview findings a matcher config currently selects (no save) |
| [**questionsControllerRematch**](QuestionsApi.md#questionscontrollerrematch) | **POST** /questions/{id}/rematch | Recompute matches against all current findings |
| [**questionsControllerRemove**](QuestionsApi.md#questionscontrollerremove) | **DELETE** /questions/{id} | Delete a question |
| [**questionsControllerUpdate**](QuestionsApi.md#questionscontrollerupdate) | **PATCH** /questions/{id} | Update a question (matchers change → matches recomputed) |



## questionsControllerCreate

> QuestionResponseDto questionsControllerCreate(createQuestionDto)

Create a question (a saved query) and seed its matches

### Example

```ts
import {
  Configuration,
  QuestionsApi,
} from '@workspace/api-client';
import type { QuestionsControllerCreateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new QuestionsApi();

  const body = {
    // CreateQuestionDto
    createQuestionDto: ...,
  } satisfies QuestionsControllerCreateRequest;

  try {
    const data = await api.questionsControllerCreate(body);
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
| **createQuestionDto** | [CreateQuestionDto](CreateQuestionDto.md) |  | |

### Return type

[**QuestionResponseDto**](QuestionResponseDto.md)

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


## questionsControllerFindOne

> QuestionResponseDto questionsControllerFindOne(id)

Get a question

### Example

```ts
import {
  Configuration,
  QuestionsApi,
} from '@workspace/api-client';
import type { QuestionsControllerFindOneRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new QuestionsApi();

  const body = {
    // string
    id: id_example,
  } satisfies QuestionsControllerFindOneRequest;

  try {
    const data = await api.questionsControllerFindOne(body);
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

[**QuestionResponseDto**](QuestionResponseDto.md)

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


## questionsControllerList

> QuestionListResponseDto questionsControllerList(search, status, caseId, skip, limit)

List questions (with match counts)

### Example

```ts
import {
  Configuration,
  QuestionsApi,
} from '@workspace/api-client';
import type { QuestionsControllerListRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new QuestionsApi();

  const body = {
    // string (optional)
    search: search_example,
    // Array<'ACTIVE' | 'ARCHIVED'> (optional)
    status: ...,
    // string | Filter to a case (or \"none\" for unlinked) (optional)
    caseId: caseId_example,
    // number (optional)
    skip: 8.14,
    // number (optional)
    limit: 8.14,
  } satisfies QuestionsControllerListRequest;

  try {
    const data = await api.questionsControllerList(body);
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
| **status** | `ACTIVE`, `ARCHIVED` |  | [Optional] [Enum: ACTIVE, ARCHIVED] |
| **caseId** | `string` | Filter to a case (or \&quot;none\&quot; for unlinked) | [Optional] [Defaults to `undefined`] |
| **skip** | `number` |  | [Optional] [Defaults to `0`] |
| **limit** | `number` |  | [Optional] [Defaults to `50`] |

### Return type

[**QuestionListResponseDto**](QuestionListResponseDto.md)

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


## questionsControllerListMatches

> Array&lt;QuestionMatchDto&gt; questionsControllerListMatches(id)

List the findings currently matching this question

### Example

```ts
import {
  Configuration,
  QuestionsApi,
} from '@workspace/api-client';
import type { QuestionsControllerListMatchesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new QuestionsApi();

  const body = {
    // string
    id: id_example,
  } satisfies QuestionsControllerListMatchesRequest;

  try {
    const data = await api.questionsControllerListMatches(body);
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

[**Array&lt;QuestionMatchDto&gt;**](QuestionMatchDto.md)

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


## questionsControllerMarkSeen

> questionsControllerMarkSeen(id)

Mark the current matches as seen (clears the \&quot;new\&quot; badge)

### Example

```ts
import {
  Configuration,
  QuestionsApi,
} from '@workspace/api-client';
import type { QuestionsControllerMarkSeenRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new QuestionsApi();

  const body = {
    // string
    id: id_example,
  } satisfies QuestionsControllerMarkSeenRequest;

  try {
    const data = await api.questionsControllerMarkSeen(body);
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


## questionsControllerMatchOptions

> MatchOptionsResponseDto questionsControllerMatchOptions(sourceIds)

Sources, custom detectors and distinct finding types for the matcher form

### Example

```ts
import {
  Configuration,
  QuestionsApi,
} from '@workspace/api-client';
import type { QuestionsControllerMatchOptionsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new QuestionsApi();

  const body = {
    // Array<string> (optional)
    sourceIds: ...,
  } satisfies QuestionsControllerMatchOptionsRequest;

  try {
    const data = await api.questionsControllerMatchOptions(body);
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
| **sourceIds** | `Array<string>` |  | [Optional] |

### Return type

[**MatchOptionsResponseDto**](MatchOptionsResponseDto.md)

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


## questionsControllerPreview

> PreviewResponseDto questionsControllerPreview(previewQuestionDto)

Preview findings a matcher config currently selects (no save)

### Example

```ts
import {
  Configuration,
  QuestionsApi,
} from '@workspace/api-client';
import type { QuestionsControllerPreviewRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new QuestionsApi();

  const body = {
    // PreviewQuestionDto
    previewQuestionDto: ...,
  } satisfies QuestionsControllerPreviewRequest;

  try {
    const data = await api.questionsControllerPreview(body);
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
| **previewQuestionDto** | [PreviewQuestionDto](PreviewQuestionDto.md) |  | |

### Return type

[**PreviewResponseDto**](PreviewResponseDto.md)

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


## questionsControllerRematch

> RematchResponseDto questionsControllerRematch(id)

Recompute matches against all current findings

### Example

```ts
import {
  Configuration,
  QuestionsApi,
} from '@workspace/api-client';
import type { QuestionsControllerRematchRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new QuestionsApi();

  const body = {
    // string
    id: id_example,
  } satisfies QuestionsControllerRematchRequest;

  try {
    const data = await api.questionsControllerRematch(body);
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

[**RematchResponseDto**](RematchResponseDto.md)

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


## questionsControllerRemove

> questionsControllerRemove(id)

Delete a question

### Example

```ts
import {
  Configuration,
  QuestionsApi,
} from '@workspace/api-client';
import type { QuestionsControllerRemoveRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new QuestionsApi();

  const body = {
    // string
    id: id_example,
  } satisfies QuestionsControllerRemoveRequest;

  try {
    const data = await api.questionsControllerRemove(body);
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


## questionsControllerUpdate

> QuestionResponseDto questionsControllerUpdate(id, updateQuestionDto)

Update a question (matchers change → matches recomputed)

### Example

```ts
import {
  Configuration,
  QuestionsApi,
} from '@workspace/api-client';
import type { QuestionsControllerUpdateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new QuestionsApi();

  const body = {
    // string
    id: id_example,
    // UpdateQuestionDto
    updateQuestionDto: ...,
  } satisfies QuestionsControllerUpdateRequest;

  try {
    const data = await api.questionsControllerUpdate(body);
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
| **updateQuestionDto** | [UpdateQuestionDto](UpdateQuestionDto.md) |  | |

### Return type

[**QuestionResponseDto**](QuestionResponseDto.md)

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

