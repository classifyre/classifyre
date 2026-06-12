# CasesApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**caseTimelineControllerGetTimeline**](CasesApi.md#casetimelinecontrollergettimeline) | **GET** /cases/{caseId}/timeline | Paginated unified case activity feed (newest first) |
| [**casesControllerAddEvidence**](CasesApi.md#casescontrolleraddevidence) | **POST** /cases/{id}/evidence | Attach an asset as evidence |
| [**casesControllerAddFinding**](CasesApi.md#casescontrolleraddfinding) | **POST** /cases/{id}/evidence/{evidenceId}/findings | Attach a finding to a piece of evidence |
| [**casesControllerAttachFindings**](CasesApi.md#casescontrollerattachfindings) | **POST** /cases/{id}/findings | Batch-attach findings (asset evidence rows are created as needed) |
| [**casesControllerClose**](CasesApi.md#casescontrollerclose) | **POST** /cases/{id}/close | Close a case with a conclusion (archives linked inquiries) |
| [**casesControllerCreate**](CasesApi.md#casescontrollercreate) | **POST** /cases | Create a case (optionally linking questions) |
| [**casesControllerFindOne**](CasesApi.md#casescontrollerfindone) | **GET** /cases/{id} | Get a case with evidence, findings and linked questions |
| [**casesControllerGraph**](CasesApi.md#casescontrollergraph) | **GET** /cases/{id}/graph | Get the evidence neighbourhood graph for a case |
| [**casesControllerLinkInquiries**](CasesApi.md#casescontrollerlinkinquiries) | **POST** /cases/{id}/inquiries | Link inquiries to a case (already-linked ones are ignored) |
| [**casesControllerList**](CasesApi.md#casescontrollerlist) | **GET** /cases | List cases |
| [**casesControllerPatchEvidenceNote**](CasesApi.md#casescontrollerpatchevidencenote) | **PATCH** /cases/{id}/evidence/{evidenceId} | Update the note on an evidence row |
| [**casesControllerPatchFindingNote**](CasesApi.md#casescontrollerpatchfindingnote) | **PATCH** /cases/{id}/findings/{caseFindingId} | Update the note on a case finding |
| [**casesControllerPull**](CasesApi.md#casescontrollerpull) | **POST** /cases/{id}/pull | Pull a question\&#39;s matches into the case as evidence |
| [**casesControllerRemove**](CasesApi.md#casescontrollerremove) | **DELETE** /cases/{id} | Delete a case (its questions become standalone) |
| [**casesControllerRemoveEvidence**](CasesApi.md#casescontrollerremoveevidence) | **DELETE** /cases/{id}/evidence/{evidenceId} | Remove evidence from the case |
| [**casesControllerRemoveFinding**](CasesApi.md#casescontrollerremovefinding) | **DELETE** /cases/{id}/findings/{caseFindingId} | Remove a finding from the case |
| [**casesControllerUnlinkInquiry**](CasesApi.md#casescontrollerunlinkinquiry) | **DELETE** /cases/{id}/inquiries/{inquiryId} | Unlink an inquiry from a case (the inquiry is untouched) |
| [**casesControllerUpdate**](CasesApi.md#casescontrollerupdate) | **PATCH** /cases/{id} | Update a case |



## caseTimelineControllerGetTimeline

> CaseTimelineResponseDto caseTimelineControllerGetTimeline(caseId, cursor, limit)

Paginated unified case activity feed (newest first)

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CaseTimelineControllerGetTimelineRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    caseId: caseId_example,
    // string (optional)
    cursor: cursor_example,
    // string (optional)
    limit: limit_example,
  } satisfies CaseTimelineControllerGetTimelineRequest;

  try {
    const data = await api.caseTimelineControllerGetTimeline(body);
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
| **caseId** | `string` |  | [Defaults to `undefined`] |
| **cursor** | `string` |  | [Optional] [Defaults to `undefined`] |
| **limit** | `string` |  | [Optional] [Defaults to `undefined`] |

### Return type

[**CaseTimelineResponseDto**](CaseTimelineResponseDto.md)

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


## casesControllerAddEvidence

> CaseEvidenceDto casesControllerAddEvidence(id, addEvidenceDto)

Attach an asset as evidence

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


## casesControllerAddFinding

> CaseFindingDto casesControllerAddFinding(id, evidenceId, addFindingDto)

Attach a finding to a piece of evidence

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CasesControllerAddFindingRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    id: id_example,
    // string
    evidenceId: evidenceId_example,
    // AddFindingDto
    addFindingDto: ...,
  } satisfies CasesControllerAddFindingRequest;

  try {
    const data = await api.casesControllerAddFinding(body);
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
| **addFindingDto** | [AddFindingDto](AddFindingDto.md) |  | |

### Return type

[**CaseFindingDto**](CaseFindingDto.md)

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


## casesControllerAttachFindings

> AttachFindingsResponseDto casesControllerAttachFindings(id, attachFindingsDto)

Batch-attach findings (asset evidence rows are created as needed)

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CasesControllerAttachFindingsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    id: id_example,
    // AttachFindingsDto
    attachFindingsDto: ...,
  } satisfies CasesControllerAttachFindingsRequest;

  try {
    const data = await api.casesControllerAttachFindings(body);
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
| **attachFindingsDto** | [AttachFindingsDto](AttachFindingsDto.md) |  | |

### Return type

[**AttachFindingsResponseDto**](AttachFindingsResponseDto.md)

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


## casesControllerClose

> CloseCaseResponseDto casesControllerClose(id, closeCaseDto)

Close a case with a conclusion (archives linked inquiries)

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CasesControllerCloseRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    id: id_example,
    // CloseCaseDto
    closeCaseDto: ...,
  } satisfies CasesControllerCloseRequest;

  try {
    const data = await api.casesControllerClose(body);
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
| **closeCaseDto** | [CloseCaseDto](CloseCaseDto.md) |  | |

### Return type

[**CloseCaseResponseDto**](CloseCaseResponseDto.md)

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


## casesControllerCreate

> CaseResponseDto casesControllerCreate(createCaseDto)

Create a case (optionally linking questions)

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

Get a case with evidence, findings and linked questions

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


## casesControllerLinkInquiries

> CaseResponseDto casesControllerLinkInquiries(id, linkInquiriesDto)

Link inquiries to a case (already-linked ones are ignored)

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CasesControllerLinkInquiriesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    id: id_example,
    // LinkInquiriesDto
    linkInquiriesDto: ...,
  } satisfies CasesControllerLinkInquiriesRequest;

  try {
    const data = await api.casesControllerLinkInquiries(body);
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
| **linkInquiriesDto** | [LinkInquiriesDto](LinkInquiriesDto.md) |  | |

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


## casesControllerList

> CaseListResponseDto casesControllerList(search, status, severity, skip, limit)

List cases

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


## casesControllerPatchEvidenceNote

> CaseEvidenceDto casesControllerPatchEvidenceNote(id, evidenceId, updateEvidenceNoteDto)

Update the note on an evidence row

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CasesControllerPatchEvidenceNoteRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    id: id_example,
    // string
    evidenceId: evidenceId_example,
    // UpdateEvidenceNoteDto
    updateEvidenceNoteDto: ...,
  } satisfies CasesControllerPatchEvidenceNoteRequest;

  try {
    const data = await api.casesControllerPatchEvidenceNote(body);
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
| **updateEvidenceNoteDto** | [UpdateEvidenceNoteDto](UpdateEvidenceNoteDto.md) |  | |

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
| **200** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## casesControllerPatchFindingNote

> CaseFindingDto casesControllerPatchFindingNote(id, caseFindingId, updateCaseFindingNoteDto)

Update the note on a case finding

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CasesControllerPatchFindingNoteRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    id: id_example,
    // string
    caseFindingId: caseFindingId_example,
    // UpdateCaseFindingNoteDto
    updateCaseFindingNoteDto: ...,
  } satisfies CasesControllerPatchFindingNoteRequest;

  try {
    const data = await api.casesControllerPatchFindingNote(body);
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
| **caseFindingId** | `string` |  | [Defaults to `undefined`] |
| **updateCaseFindingNoteDto** | [UpdateCaseFindingNoteDto](UpdateCaseFindingNoteDto.md) |  | |

### Return type

[**CaseFindingDto**](CaseFindingDto.md)

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


## casesControllerPull

> PullFromInquiryResponseDto casesControllerPull(id, pullFromInquiryDto)

Pull a question\&#39;s matches into the case as evidence

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CasesControllerPullRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    id: id_example,
    // PullFromInquiryDto
    pullFromInquiryDto: ...,
  } satisfies CasesControllerPullRequest;

  try {
    const data = await api.casesControllerPull(body);
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
| **pullFromInquiryDto** | [PullFromInquiryDto](PullFromInquiryDto.md) |  | |

### Return type

[**PullFromInquiryResponseDto**](PullFromInquiryResponseDto.md)

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


## casesControllerRemove

> casesControllerRemove(id)

Delete a case (its questions become standalone)

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


## casesControllerRemoveFinding

> casesControllerRemoveFinding(id, caseFindingId)

Remove a finding from the case

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CasesControllerRemoveFindingRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    id: id_example,
    // string
    caseFindingId: caseFindingId_example,
  } satisfies CasesControllerRemoveFindingRequest;

  try {
    const data = await api.casesControllerRemoveFinding(body);
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
| **caseFindingId** | `string` |  | [Defaults to `undefined`] |

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


## casesControllerUnlinkInquiry

> CaseResponseDto casesControllerUnlinkInquiry(id, inquiryId)

Unlink an inquiry from a case (the inquiry is untouched)

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CasesControllerUnlinkInquiryRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    id: id_example,
    // string
    inquiryId: inquiryId_example,
  } satisfies CasesControllerUnlinkInquiryRequest;

  try {
    const data = await api.casesControllerUnlinkInquiry(body);
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
| **inquiryId** | `string` |  | [Defaults to `undefined`] |

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

