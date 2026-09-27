# CasesApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**caseCleanupControllerAddFilters**](CasesApi.md#casecleanupcontrolleraddfilters) | **POST** /cases/{id}/finding-filters | Add finding filters (case-wide or for one watch); matching findings leave the case now and are not pulled again |
| [**caseCleanupControllerClearEscalations**](CasesApi.md#casecleanupcontrollerclearescalations) | **POST** /cases/{id}/escalations/clear | Take the escalation mark off findings of the case (all of them when findingIds is omitted); the findings stay |
| [**caseCleanupControllerFilterOptions**](CasesApi.md#casecleanupcontrollerfilteroptions) | **GET** /cases/{id}/finding-filters/options | Finding types a filter can pick from: what the case holds and what its watches (or one watch) answer |
| [**caseCleanupControllerListFilters**](CasesApi.md#casecleanupcontrollerlistfilters) | **GET** /cases/{id}/finding-filters | The case\&#39;s finding filters, case-wide and per watch |
| [**caseCleanupControllerPreviewCleanup**](CasesApi.md#casecleanupcontrollerpreviewcleanup) | **POST** /cases/{id}/cleanup/preview | What the given clean-up switches would take out of the case right now (writes nothing) |
| [**caseCleanupControllerPreviewFilters**](CasesApi.md#casecleanupcontrollerpreviewfilters) | **POST** /cases/{id}/finding-filters/preview | How many findings in the case unsaved filter rules would take out now (writes nothing) |
| [**caseCleanupControllerRemoveFilter**](CasesApi.md#casecleanupcontrollerremovefilter) | **DELETE** /cases/{id}/finding-filters/{filterId} | Remove a filter. Findings it took out stay out; the watch just stops skipping them |
| [**caseCleanupControllerUpdateFilter**](CasesApi.md#casecleanupcontrollerupdatefilter) | **PATCH** /cases/{id}/finding-filters/{filterId} | Change a filter\&#39;s pattern or description; a new pattern takes out what it now matches |
| [**caseEventsControllerCreate**](CasesApi.md#caseeventscontrollercreate) | **POST** /cases/{caseId}/events | Add a dated event to the case chronology |
| [**caseEventsControllerList**](CasesApi.md#caseeventscontrollerlist) | **GET** /cases/{caseId}/events | List the case chronology (real-world events, ordered by date) |
| [**caseEventsControllerRemove**](CasesApi.md#caseeventscontrollerremove) | **DELETE** /cases/{caseId}/events/{eventId} | Remove a chronology event |
| [**caseEventsControllerUpdate**](CasesApi.md#caseeventscontrollerupdate) | **PATCH** /cases/{caseId}/events/{eventId} | Update (and implicitly verify) a chronology event |
| [**caseLeadsControllerGenerate**](CasesApi.md#caseleadscontrollergenerate) | **POST** /cases/{caseId}/leads/generate | Refresh leads now (similar content, watch answers, look-alike documents). The case also refreshes them by itself when its evidence or watches change |
| [**caseLeadsControllerList**](CasesApi.md#caseleadscontrollerlist) | **GET** /cases/{caseId}/leads | List leads (exploration candidates) for a case |
| [**caseLeadsControllerPropose**](CasesApi.md#caseleadscontrollerpropose) | **POST** /cases/{caseId}/leads | Propose a finding as a lead for this case |
| [**caseLeadsControllerReview**](CasesApi.md#caseleadscontrollerreview) | **POST** /cases/{caseId}/leads/{leadId}/review | Accept a lead into evidence, or dismiss it |
| [**caseLeadsControllerReviewMany**](CasesApi.md#caseleadscontrollerreviewmany) | **POST** /cases/{caseId}/leads/review | Accept or dismiss several leads with one decision |
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
| [**casesControllerSetInquiryAutoPull**](CasesApi.md#casescontrollersetinquiryautopull) | **PATCH** /cases/{id}/inquiries/{inquiryId} | Turn automatic pulling of an inquiry\&#39;s new matches on or off |
| [**casesControllerUnlinkInquiry**](CasesApi.md#casescontrollerunlinkinquiry) | **DELETE** /cases/{id}/inquiries/{inquiryId} | Unlink an inquiry from a case (the inquiry is untouched) |
| [**casesControllerUpdate**](CasesApi.md#casescontrollerupdate) | **PATCH** /cases/{id} | Update a case |
| [**caseworkControllerSummary**](CasesApi.md#caseworkcontrollersummary) | **GET** /casework/summary | Counts and recent activity across cases, inquiries and leads |



## caseCleanupControllerAddFilters

> CaseFindingFiltersChangeResponseDto caseCleanupControllerAddFilters(id, addCaseFindingFiltersDto)

Add finding filters (case-wide or for one watch); matching findings leave the case now and are not pulled again

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CaseCleanupControllerAddFiltersRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    id: id_example,
    // AddCaseFindingFiltersDto
    addCaseFindingFiltersDto: ...,
  } satisfies CaseCleanupControllerAddFiltersRequest;

  try {
    const data = await api.caseCleanupControllerAddFilters(body);
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
| **addCaseFindingFiltersDto** | [AddCaseFindingFiltersDto](AddCaseFindingFiltersDto.md) |  | |

### Return type

[**CaseFindingFiltersChangeResponseDto**](CaseFindingFiltersChangeResponseDto.md)

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


## caseCleanupControllerClearEscalations

> ClearCaseEscalationsResponseDto caseCleanupControllerClearEscalations(id, clearCaseEscalationsDto)

Take the escalation mark off findings of the case (all of them when findingIds is omitted); the findings stay

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CaseCleanupControllerClearEscalationsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    id: id_example,
    // ClearCaseEscalationsDto
    clearCaseEscalationsDto: ...,
  } satisfies CaseCleanupControllerClearEscalationsRequest;

  try {
    const data = await api.caseCleanupControllerClearEscalations(body);
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
| **clearCaseEscalationsDto** | [ClearCaseEscalationsDto](ClearCaseEscalationsDto.md) |  | |

### Return type

[**ClearCaseEscalationsResponseDto**](ClearCaseEscalationsResponseDto.md)

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


## caseCleanupControllerFilterOptions

> CaseFindingFilterOptionsDto caseCleanupControllerFilterOptions(id, inquiryId)

Finding types a filter can pick from: what the case holds and what its watches (or one watch) answer

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CaseCleanupControllerFilterOptionsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    id: id_example,
    // string (optional)
    inquiryId: inquiryId_example,
  } satisfies CaseCleanupControllerFilterOptionsRequest;

  try {
    const data = await api.caseCleanupControllerFilterOptions(body);
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
| **inquiryId** | `string` |  | [Optional] [Defaults to `undefined`] |

### Return type

[**CaseFindingFilterOptionsDto**](CaseFindingFilterOptionsDto.md)

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


## caseCleanupControllerListFilters

> Array&lt;CaseFindingFilterDto&gt; caseCleanupControllerListFilters(id)

The case\&#39;s finding filters, case-wide and per watch

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CaseCleanupControllerListFiltersRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    id: id_example,
  } satisfies CaseCleanupControllerListFiltersRequest;

  try {
    const data = await api.caseCleanupControllerListFilters(body);
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

[**Array&lt;CaseFindingFilterDto&gt;**](CaseFindingFilterDto.md)

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


## caseCleanupControllerPreviewCleanup

> CaseCleanupPreviewDto caseCleanupControllerPreviewCleanup(id, caseCleanupRulesDto)

What the given clean-up switches would take out of the case right now (writes nothing)

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CaseCleanupControllerPreviewCleanupRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    id: id_example,
    // CaseCleanupRulesDto
    caseCleanupRulesDto: ...,
  } satisfies CaseCleanupControllerPreviewCleanupRequest;

  try {
    const data = await api.caseCleanupControllerPreviewCleanup(body);
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
| **caseCleanupRulesDto** | [CaseCleanupRulesDto](CaseCleanupRulesDto.md) |  | |

### Return type

[**CaseCleanupPreviewDto**](CaseCleanupPreviewDto.md)

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


## caseCleanupControllerPreviewFilters

> CaseFindingFiltersPreviewDto caseCleanupControllerPreviewFilters(id, previewCaseFindingFiltersDto)

How many findings in the case unsaved filter rules would take out now (writes nothing)

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CaseCleanupControllerPreviewFiltersRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    id: id_example,
    // PreviewCaseFindingFiltersDto
    previewCaseFindingFiltersDto: ...,
  } satisfies CaseCleanupControllerPreviewFiltersRequest;

  try {
    const data = await api.caseCleanupControllerPreviewFilters(body);
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
| **previewCaseFindingFiltersDto** | [PreviewCaseFindingFiltersDto](PreviewCaseFindingFiltersDto.md) |  | |

### Return type

[**CaseFindingFiltersPreviewDto**](CaseFindingFiltersPreviewDto.md)

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


## caseCleanupControllerRemoveFilter

> Array&lt;CaseFindingFilterDto&gt; caseCleanupControllerRemoveFilter(id, filterId)

Remove a filter. Findings it took out stay out; the watch just stops skipping them

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CaseCleanupControllerRemoveFilterRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    id: id_example,
    // string
    filterId: filterId_example,
  } satisfies CaseCleanupControllerRemoveFilterRequest;

  try {
    const data = await api.caseCleanupControllerRemoveFilter(body);
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
| **filterId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**Array&lt;CaseFindingFilterDto&gt;**](CaseFindingFilterDto.md)

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


## caseCleanupControllerUpdateFilter

> CaseFindingFiltersChangeResponseDto caseCleanupControllerUpdateFilter(id, filterId, updateCaseFindingFilterDto)

Change a filter\&#39;s pattern or description; a new pattern takes out what it now matches

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CaseCleanupControllerUpdateFilterRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    id: id_example,
    // string
    filterId: filterId_example,
    // UpdateCaseFindingFilterDto
    updateCaseFindingFilterDto: ...,
  } satisfies CaseCleanupControllerUpdateFilterRequest;

  try {
    const data = await api.caseCleanupControllerUpdateFilter(body);
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
| **filterId** | `string` |  | [Defaults to `undefined`] |
| **updateCaseFindingFilterDto** | [UpdateCaseFindingFilterDto](UpdateCaseFindingFilterDto.md) |  | |

### Return type

[**CaseFindingFiltersChangeResponseDto**](CaseFindingFiltersChangeResponseDto.md)

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


## caseEventsControllerCreate

> CaseEventDto caseEventsControllerCreate(caseId, createCaseEventDto)

Add a dated event to the case chronology

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CaseEventsControllerCreateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    caseId: caseId_example,
    // CreateCaseEventDto
    createCaseEventDto: ...,
  } satisfies CaseEventsControllerCreateRequest;

  try {
    const data = await api.caseEventsControllerCreate(body);
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
| **createCaseEventDto** | [CreateCaseEventDto](CreateCaseEventDto.md) |  | |

### Return type

[**CaseEventDto**](CaseEventDto.md)

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


## caseEventsControllerList

> Array&lt;CaseEventDto&gt; caseEventsControllerList(caseId)

List the case chronology (real-world events, ordered by date)

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CaseEventsControllerListRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    caseId: caseId_example,
  } satisfies CaseEventsControllerListRequest;

  try {
    const data = await api.caseEventsControllerList(body);
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

### Return type

[**Array&lt;CaseEventDto&gt;**](CaseEventDto.md)

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


## caseEventsControllerRemove

> caseEventsControllerRemove(caseId, eventId)

Remove a chronology event

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CaseEventsControllerRemoveRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    caseId: caseId_example,
    // string
    eventId: eventId_example,
  } satisfies CaseEventsControllerRemoveRequest;

  try {
    const data = await api.caseEventsControllerRemove(body);
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
| **eventId** | `string` |  | [Defaults to `undefined`] |

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


## caseEventsControllerUpdate

> CaseEventDto caseEventsControllerUpdate(caseId, eventId, updateCaseEventDto)

Update (and implicitly verify) a chronology event

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CaseEventsControllerUpdateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    caseId: caseId_example,
    // string
    eventId: eventId_example,
    // UpdateCaseEventDto
    updateCaseEventDto: ...,
  } satisfies CaseEventsControllerUpdateRequest;

  try {
    const data = await api.caseEventsControllerUpdate(body);
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
| **eventId** | `string` |  | [Defaults to `undefined`] |
| **updateCaseEventDto** | [UpdateCaseEventDto](UpdateCaseEventDto.md) |  | |

### Return type

[**CaseEventDto**](CaseEventDto.md)

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


## caseLeadsControllerGenerate

> GenerateCaseLeadsResponseDto caseLeadsControllerGenerate(caseId)

Refresh leads now (similar content, watch answers, look-alike documents). The case also refreshes them by itself when its evidence or watches change

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CaseLeadsControllerGenerateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    caseId: caseId_example,
  } satisfies CaseLeadsControllerGenerateRequest;

  try {
    const data = await api.caseLeadsControllerGenerate(body);
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

### Return type

[**GenerateCaseLeadsResponseDto**](GenerateCaseLeadsResponseDto.md)

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


## caseLeadsControllerList

> Array&lt;CaseLeadDto&gt; caseLeadsControllerList(caseId, status)

List leads (exploration candidates) for a case

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CaseLeadsControllerListRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    caseId: caseId_example,
    // 'PROPOSED' | 'ACCEPTED' | 'DISMISSED' (optional)
    status: status_example,
  } satisfies CaseLeadsControllerListRequest;

  try {
    const data = await api.caseLeadsControllerList(body);
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
| **status** | `PROPOSED`, `ACCEPTED`, `DISMISSED` |  | [Optional] [Defaults to `undefined`] [Enum: PROPOSED, ACCEPTED, DISMISSED] |

### Return type

[**Array&lt;CaseLeadDto&gt;**](CaseLeadDto.md)

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


## caseLeadsControllerPropose

> caseLeadsControllerPropose(caseId, proposeCaseLeadDto)

Propose a finding as a lead for this case

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CaseLeadsControllerProposeRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    caseId: caseId_example,
    // ProposeCaseLeadDto
    proposeCaseLeadDto: ...,
  } satisfies CaseLeadsControllerProposeRequest;

  try {
    const data = await api.caseLeadsControllerPropose(body);
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
| **proposeCaseLeadDto** | [ProposeCaseLeadDto](ProposeCaseLeadDto.md) |  | |

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


## caseLeadsControllerReview

> caseLeadsControllerReview(caseId, leadId, reviewCaseLeadDto)

Accept a lead into evidence, or dismiss it

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CaseLeadsControllerReviewRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    caseId: caseId_example,
    // string
    leadId: leadId_example,
    // ReviewCaseLeadDto
    reviewCaseLeadDto: ...,
  } satisfies CaseLeadsControllerReviewRequest;

  try {
    const data = await api.caseLeadsControllerReview(body);
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
| **leadId** | `string` |  | [Defaults to `undefined`] |
| **reviewCaseLeadDto** | [ReviewCaseLeadDto](ReviewCaseLeadDto.md) |  | |

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


## caseLeadsControllerReviewMany

> ReviewCaseLeadsResponseDto caseLeadsControllerReviewMany(caseId, reviewCaseLeadsDto)

Accept or dismiss several leads with one decision

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CaseLeadsControllerReviewManyRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    caseId: caseId_example,
    // ReviewCaseLeadsDto
    reviewCaseLeadsDto: ...,
  } satisfies CaseLeadsControllerReviewManyRequest;

  try {
    const data = await api.caseLeadsControllerReviewMany(body);
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
| **reviewCaseLeadsDto** | [ReviewCaseLeadsDto](ReviewCaseLeadsDto.md) |  | |

### Return type

[**ReviewCaseLeadsResponseDto**](ReviewCaseLeadsResponseDto.md)

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

> CaseListResponseDto casesControllerList(search, status, severity, escalated, skip, limit)

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
    // boolean | Only cases holding escalated findings (optional)
    escalated: true,
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
| **escalated** | `boolean` | Only cases holding escalated findings | [Optional] [Defaults to `undefined`] |
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


## casesControllerSetInquiryAutoPull

> CaseResponseDto casesControllerSetInquiryAutoPull(id, inquiryId, setInquiryAutoPullDto)

Turn automatic pulling of an inquiry\&#39;s new matches on or off

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CasesControllerSetInquiryAutoPullRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  const body = {
    // string
    id: id_example,
    // string
    inquiryId: inquiryId_example,
    // SetInquiryAutoPullDto
    setInquiryAutoPullDto: ...,
  } satisfies CasesControllerSetInquiryAutoPullRequest;

  try {
    const data = await api.casesControllerSetInquiryAutoPull(body);
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
| **setInquiryAutoPullDto** | [SetInquiryAutoPullDto](SetInquiryAutoPullDto.md) |  | |

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


## caseworkControllerSummary

> CaseworkSummaryDto caseworkControllerSummary()

Counts and recent activity across cases, inquiries and leads

What is being investigated right now, for the workspace dashboard. Grouped counts plus the five most recent cases and the five inquiries with the most unseen matches — no scan over findings.

### Example

```ts
import {
  Configuration,
  CasesApi,
} from '@workspace/api-client';
import type { CaseworkControllerSummaryRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CasesApi();

  try {
    const data = await api.caseworkControllerSummary();
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

[**CaseworkSummaryDto**](CaseworkSummaryDto.md)

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

