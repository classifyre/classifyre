# InquiriesApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**inquiriesControllerCreate**](InquiriesApi.md#inquiriescontrollercreate) | **POST** /inquiries | Create an inquiry (a saved query) and seed its matches |
| [**inquiriesControllerFindOne**](InquiriesApi.md#inquiriescontrollerfindone) | **GET** /inquiries/{id} | Get an inquiry |
| [**inquiriesControllerList**](InquiriesApi.md#inquiriescontrollerlist) | **GET** /inquiries | List inquiries (with match counts) |
| [**inquiriesControllerListMatches**](InquiriesApi.md#inquiriescontrollerlistmatches) | **GET** /inquiries/{id}/matches | List the findings currently matching this inquiry (paginated) |
| [**inquiriesControllerMarkSeen**](InquiriesApi.md#inquiriescontrollermarkseen) | **POST** /inquiries/{id}/seen | Mark the current matches as seen (clears the \&quot;new\&quot; badge) |
| [**inquiriesControllerMatchOptions**](InquiriesApi.md#inquiriescontrollermatchoptions) | **GET** /inquiries/match-options | Sources, custom detectors and distinct finding types for the matcher form |
| [**inquiriesControllerPreview**](InquiriesApi.md#inquiriescontrollerpreview) | **POST** /inquiries/preview | Preview findings a matcher config currently selects (no save) |
| [**inquiriesControllerRematch**](InquiriesApi.md#inquiriescontrollerrematch) | **POST** /inquiries/{id}/rematch | Recompute matches against all current findings |
| [**inquiriesControllerRemove**](InquiriesApi.md#inquiriescontrollerremove) | **DELETE** /inquiries/{id} | Delete an inquiry |
| [**inquiriesControllerUpdate**](InquiriesApi.md#inquiriescontrollerupdate) | **PATCH** /inquiries/{id} | Update an inquiry (matchers change → matches recomputed) |



## inquiriesControllerCreate

> InquiryResponseDto inquiriesControllerCreate(createInquiryDto)

Create an inquiry (a saved query) and seed its matches

### Example

```ts
import {
  Configuration,
  InquiriesApi,
} from '@workspace/api-client';
import type { InquiriesControllerCreateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new InquiriesApi();

  const body = {
    // CreateInquiryDto
    createInquiryDto: ...,
  } satisfies InquiriesControllerCreateRequest;

  try {
    const data = await api.inquiriesControllerCreate(body);
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
| **createInquiryDto** | [CreateInquiryDto](CreateInquiryDto.md) |  | |

### Return type

[**InquiryResponseDto**](InquiryResponseDto.md)

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


## inquiriesControllerFindOne

> InquiryResponseDto inquiriesControllerFindOne(id)

Get an inquiry

### Example

```ts
import {
  Configuration,
  InquiriesApi,
} from '@workspace/api-client';
import type { InquiriesControllerFindOneRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new InquiriesApi();

  const body = {
    // string
    id: id_example,
  } satisfies InquiriesControllerFindOneRequest;

  try {
    const data = await api.inquiriesControllerFindOne(body);
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

[**InquiryResponseDto**](InquiryResponseDto.md)

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


## inquiriesControllerList

> InquiryListResponseDto inquiriesControllerList(search, status, caseId, skip, limit)

List inquiries (with match counts)

### Example

```ts
import {
  Configuration,
  InquiriesApi,
} from '@workspace/api-client';
import type { InquiriesControllerListRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new InquiriesApi();

  const body = {
    // string (optional)
    search: search_example,
    // Array<'ACTIVE' | 'ARCHIVED'> (optional)
    status: ...,
    // string | Filter to inquiries linked to a case (or \"none\" for unlinked) (optional)
    caseId: caseId_example,
    // number (optional)
    skip: 8.14,
    // number (optional)
    limit: 8.14,
  } satisfies InquiriesControllerListRequest;

  try {
    const data = await api.inquiriesControllerList(body);
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
| **caseId** | `string` | Filter to inquiries linked to a case (or \&quot;none\&quot; for unlinked) | [Optional] [Defaults to `undefined`] |
| **skip** | `number` |  | [Optional] [Defaults to `0`] |
| **limit** | `number` |  | [Optional] [Defaults to `50`] |

### Return type

[**InquiryListResponseDto**](InquiryListResponseDto.md)

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


## inquiriesControllerListMatches

> InquiryMatchListResponseDto inquiriesControllerListMatches(id, search, severity, onlyNew, skip, limit)

List the findings currently matching this inquiry (paginated)

### Example

```ts
import {
  Configuration,
  InquiriesApi,
} from '@workspace/api-client';
import type { InquiriesControllerListMatchesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new InquiriesApi();

  const body = {
    // string
    id: id_example,
    // string | Substring match on finding type, asset name or matched content (optional)
    search: search_example,
    // Array<'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'> (optional)
    severity: ...,
    // boolean | Only matches that appeared since last seen (optional)
    onlyNew: true,
    // number (optional)
    skip: 8.14,
    // number (optional)
    limit: 8.14,
  } satisfies InquiriesControllerListMatchesRequest;

  try {
    const data = await api.inquiriesControllerListMatches(body);
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
| **search** | `string` | Substring match on finding type, asset name or matched content | [Optional] [Defaults to `undefined`] |
| **severity** | `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFO` |  | [Optional] [Enum: CRITICAL, HIGH, MEDIUM, LOW, INFO] |
| **onlyNew** | `boolean` | Only matches that appeared since last seen | [Optional] [Defaults to `undefined`] |
| **skip** | `number` |  | [Optional] [Defaults to `0`] |
| **limit** | `number` |  | [Optional] [Defaults to `50`] |

### Return type

[**InquiryMatchListResponseDto**](InquiryMatchListResponseDto.md)

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


## inquiriesControllerMarkSeen

> inquiriesControllerMarkSeen(id)

Mark the current matches as seen (clears the \&quot;new\&quot; badge)

### Example

```ts
import {
  Configuration,
  InquiriesApi,
} from '@workspace/api-client';
import type { InquiriesControllerMarkSeenRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new InquiriesApi();

  const body = {
    // string
    id: id_example,
  } satisfies InquiriesControllerMarkSeenRequest;

  try {
    const data = await api.inquiriesControllerMarkSeen(body);
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


## inquiriesControllerMatchOptions

> MatchOptionsResponseDto inquiriesControllerMatchOptions(sourceIds)

Sources, custom detectors and distinct finding types for the matcher form

### Example

```ts
import {
  Configuration,
  InquiriesApi,
} from '@workspace/api-client';
import type { InquiriesControllerMatchOptionsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new InquiriesApi();

  const body = {
    // Array<string> (optional)
    sourceIds: ...,
  } satisfies InquiriesControllerMatchOptionsRequest;

  try {
    const data = await api.inquiriesControllerMatchOptions(body);
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


## inquiriesControllerPreview

> PreviewResponseDto inquiriesControllerPreview(previewInquiryDto)

Preview findings a matcher config currently selects (no save)

### Example

```ts
import {
  Configuration,
  InquiriesApi,
} from '@workspace/api-client';
import type { InquiriesControllerPreviewRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new InquiriesApi();

  const body = {
    // PreviewInquiryDto
    previewInquiryDto: ...,
  } satisfies InquiriesControllerPreviewRequest;

  try {
    const data = await api.inquiriesControllerPreview(body);
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
| **previewInquiryDto** | [PreviewInquiryDto](PreviewInquiryDto.md) |  | |

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


## inquiriesControllerRematch

> RematchResponseDto inquiriesControllerRematch(id)

Recompute matches against all current findings

### Example

```ts
import {
  Configuration,
  InquiriesApi,
} from '@workspace/api-client';
import type { InquiriesControllerRematchRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new InquiriesApi();

  const body = {
    // string
    id: id_example,
  } satisfies InquiriesControllerRematchRequest;

  try {
    const data = await api.inquiriesControllerRematch(body);
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


## inquiriesControllerRemove

> inquiriesControllerRemove(id)

Delete an inquiry

### Example

```ts
import {
  Configuration,
  InquiriesApi,
} from '@workspace/api-client';
import type { InquiriesControllerRemoveRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new InquiriesApi();

  const body = {
    // string
    id: id_example,
  } satisfies InquiriesControllerRemoveRequest;

  try {
    const data = await api.inquiriesControllerRemove(body);
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


## inquiriesControllerUpdate

> InquiryResponseDto inquiriesControllerUpdate(id, updateInquiryDto)

Update an inquiry (matchers change → matches recomputed)

### Example

```ts
import {
  Configuration,
  InquiriesApi,
} from '@workspace/api-client';
import type { InquiriesControllerUpdateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new InquiriesApi();

  const body = {
    // string
    id: id_example,
    // UpdateInquiryDto
    updateInquiryDto: ...,
  } satisfies InquiriesControllerUpdateRequest;

  try {
    const data = await api.inquiriesControllerUpdate(body);
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
| **updateInquiryDto** | [UpdateInquiryDto](UpdateInquiryDto.md) |  | |

### Return type

[**InquiryResponseDto**](InquiryResponseDto.md)

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

