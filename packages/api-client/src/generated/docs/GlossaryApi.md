# GlossaryApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**glossaryControllerActivity**](GlossaryApi.md#glossarycontrolleractivity) | **GET** /glossary/terms/{idOrKey}/activity | A term\&#39;s history (paged) |
| [**glossaryControllerApprove**](GlossaryApi.md#glossarycontrollerapprove) | **POST** /glossary/{id}/approve | DRAFT → APPROVED |
| [**glossaryControllerApproveRelation**](GlossaryApi.md#glossarycontrollerapproverelation) | **POST** /glossary/relations/{id}/approve |  |
| [**glossaryControllerBulkUpdate**](GlossaryApi.md#glossarycontrollerbulkupdate) | **POST** /glossary/bulk | Bulk approve/unapprove/deprecate, retype, move scheme or change kind (operator) |
| [**glossaryControllerCreateRelation**](GlossaryApi.md#glossarycontrollercreaterelation) | **POST** /glossary/relations | Create a relation (APPROVED for operators) |
| [**glossaryControllerCreateScheme**](GlossaryApi.md#glossarycontrollercreatescheme) | **POST** /glossary/schemes | Create a scheme |
| [**glossaryControllerDeleteScheme**](GlossaryApi.md#glossarycontrollerdeletescheme) | **DELETE** /glossary/schemes/{id} | Delete an empty scheme |
| [**glossaryControllerDeprecate**](GlossaryApi.md#glossarycontrollerdeprecate) | **POST** /glossary/{id}/deprecate | APPROVED → DEPRECATED, optionally with a successor |
| [**glossaryControllerExport**](GlossaryApi.md#glossarycontrollerexport) | **GET** /glossary/export | Export as CSV or SKOS JSON-LD |
| [**glossaryControllerGetScheme**](GlossaryApi.md#glossarycontrollergetscheme) | **GET** /glossary/schemes/{id} |  |
| [**glossaryControllerGetTerm**](GlossaryApi.md#glossarycontrollergetterm) | **GET** /glossary/terms/{idOrKey} | A term by id or key (old keys resolve): scheme, relations, broader chain, narrower list |
| [**glossaryControllerImport**](GlossaryApi.md#glossarycontrollerimport) | **POST** /glossary/import | Import CSV or SKOS JSON-LD. Defaults to a dry run that reports creates, updates, skips, conflicts and refusals. |
| [**glossaryControllerImportJob**](GlossaryApi.md#glossarycontrollerimportjob) | **GET** /glossary/import/{jobId} | An import report |
| [**glossaryControllerList**](GlossaryApi.md#glossarycontrollerlist) | **GET** /glossary | List glossary terms |
| [**glossaryControllerListRelations**](GlossaryApi.md#glossarycontrollerlistrelations) | **GET** /glossary/relations | List relations |
| [**glossaryControllerListSchemes**](GlossaryApi.md#glossarycontrollerlistschemes) | **GET** /glossary/schemes | List schemes with term counts |
| [**glossaryControllerLookup**](GlossaryApi.md#glossarycontrollerlookup) | **GET** /glossary/lookup | Resolve a name, alias, code or hidden alias to glossary terms (exact, prefix, substring, semantic) |
| [**glossaryControllerReinstate**](GlossaryApi.md#glossarycontrollerreinstate) | **POST** /glossary/{id}/reinstate | DEPRECATED → APPROVED |
| [**glossaryControllerRemove**](GlossaryApi.md#glossarycontrollerremove) | **DELETE** /glossary/{id} | Delete a glossary term (deletion is remembered) |
| [**glossaryControllerRemoveRelation**](GlossaryApi.md#glossarycontrollerremoverelation) | **DELETE** /glossary/relations/{id} |  |
| [**glossaryControllerTree**](GlossaryApi.md#glossarycontrollertree) | **GET** /glossary/schemes/{id}/tree | One level of a scheme taxonomy: roots, or the narrower concepts of parentId |
| [**glossaryControllerUnapprove**](GlossaryApi.md#glossarycontrollerunapprove) | **POST** /glossary/{id}/unapprove | APPROVED → DRAFT |
| [**glossaryControllerUpdateScheme**](GlossaryApi.md#glossarycontrollerupdatescheme) | **PATCH** /glossary/schemes/{id} | Edit a scheme |
| [**glossaryControllerUpsert**](GlossaryApi.md#glossarycontrollerupsert) | **POST** /glossary | Create or update a glossary term (operator) |
| [**glossarySemanticControllerCounts**](GlossaryApi.md#glossarysemanticcontrollercounts) | **GET** /glossary/proposals/counts | Pending proposals by kind, for the badge |
| [**glossarySemanticControllerDecide**](GlossaryApi.md#glossarysemanticcontrollerdecide) | **POST** /glossary/proposals/decide | Accept, edit and accept, dismiss, dismiss forever or skip one proposal |
| [**glossarySemanticControllerDecideBulk**](GlossaryApi.md#glossarysemanticcontrollerdecidebulk) | **POST** /glossary/proposals/decide-bulk | Bulk accept or dismiss a group of document (LINK) suggestions |
| [**glossarySemanticControllerFindInTextCreate**](GlossaryApi.md#glossarysemanticcontrollerfindintextcreate) | **POST** /glossary/terms/{idOrKey}/find-in-text | \&quot;Find in text\&quot;: create a tested REGEX detector bound to the term |
| [**glossarySemanticControllerFindInTextPreview**](GlossaryApi.md#glossarysemanticcontrollerfindintextpreview) | **GET** /glossary/terms/{idOrKey}/find-in-text | \&quot;Find in text\&quot;: the labels, pattern and tests a detector would get |
| [**glossarySemanticControllerFindInTextPreviewWith**](GlossaryApi.md#glossarysemanticcontrollerfindintextpreviewwith) | **POST** /glossary/terms/{idOrKey}/find-in-text/preview |  |
| [**glossarySemanticControllerFindInTextStatus**](GlossaryApi.md#glossarysemanticcontrollerfindintextstatus) | **GET** /glossary/terms/{idOrKey}/find-in-text/detectors | Detectors generated from a term, with out-of-date flags |
| [**glossarySemanticControllerLinkGroups**](GlossaryApi.md#glossarysemanticcontrollerlinkgroups) | **GET** /glossary/proposals/link-groups | Document suggestions grouped per concept, with a score histogram |
| [**glossarySemanticControllerList**](GlossaryApi.md#glossarysemanticcontrollerlist) | **GET** /glossary/proposals | The review queue: every proposal, one paged list |



## glossaryControllerActivity

> glossaryControllerActivity(idOrKey, take, skip)

A term\&#39;s history (paged)

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerActivityRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // string
    idOrKey: idOrKey_example,
    // string
    take: take_example,
    // string
    skip: skip_example,
  } satisfies GlossaryControllerActivityRequest;

  try {
    const data = await api.glossaryControllerActivity(body);
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
| **idOrKey** | `string` |  | [Defaults to `undefined`] |
| **take** | `string` |  | [Defaults to `undefined`] |
| **skip** | `string` |  | [Defaults to `undefined`] |

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


## glossaryControllerApprove

> GlossaryTermDto glossaryControllerApprove(id)

DRAFT → APPROVED

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerApproveRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // string
    id: id_example,
  } satisfies GlossaryControllerApproveRequest;

  try {
    const data = await api.glossaryControllerApprove(body);
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

[**GlossaryTermDto**](GlossaryTermDto.md)

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


## glossaryControllerApproveRelation

> glossaryControllerApproveRelation(id)



### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerApproveRelationRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // string
    id: id_example,
  } satisfies GlossaryControllerApproveRelationRequest;

  try {
    const data = await api.glossaryControllerApproveRelation(body);
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


## glossaryControllerBulkUpdate

> BulkUpdateGlossaryTermsResponseDto glossaryControllerBulkUpdate(bulkUpdateGlossaryTermsDto)

Bulk approve/unapprove/deprecate, retype, move scheme or change kind (operator)

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerBulkUpdateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // BulkUpdateGlossaryTermsDto
    bulkUpdateGlossaryTermsDto: ...,
  } satisfies GlossaryControllerBulkUpdateRequest;

  try {
    const data = await api.glossaryControllerBulkUpdate(body);
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
| **bulkUpdateGlossaryTermsDto** | [BulkUpdateGlossaryTermsDto](BulkUpdateGlossaryTermsDto.md) |  | |

### Return type

[**BulkUpdateGlossaryTermsResponseDto**](BulkUpdateGlossaryTermsResponseDto.md)

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


## glossaryControllerCreateRelation

> glossaryControllerCreateRelation(createGlossaryRelationDto)

Create a relation (APPROVED for operators)

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerCreateRelationRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // CreateGlossaryRelationDto
    createGlossaryRelationDto: ...,
  } satisfies GlossaryControllerCreateRelationRequest;

  try {
    const data = await api.glossaryControllerCreateRelation(body);
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
| **createGlossaryRelationDto** | [CreateGlossaryRelationDto](CreateGlossaryRelationDto.md) |  | |

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


## glossaryControllerCreateScheme

> GlossarySchemeDto glossaryControllerCreateScheme(upsertGlossarySchemeDto)

Create a scheme

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerCreateSchemeRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // UpsertGlossarySchemeDto
    upsertGlossarySchemeDto: ...,
  } satisfies GlossaryControllerCreateSchemeRequest;

  try {
    const data = await api.glossaryControllerCreateScheme(body);
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
| **upsertGlossarySchemeDto** | [UpsertGlossarySchemeDto](UpsertGlossarySchemeDto.md) |  | |

### Return type

[**GlossarySchemeDto**](GlossarySchemeDto.md)

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


## glossaryControllerDeleteScheme

> glossaryControllerDeleteScheme(id)

Delete an empty scheme

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerDeleteSchemeRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // string
    id: id_example,
  } satisfies GlossaryControllerDeleteSchemeRequest;

  try {
    const data = await api.glossaryControllerDeleteScheme(body);
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


## glossaryControllerDeprecate

> GlossaryTermDto glossaryControllerDeprecate(id, deprecateGlossaryTermDto)

APPROVED → DEPRECATED, optionally with a successor

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerDeprecateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // string
    id: id_example,
    // DeprecateGlossaryTermDto
    deprecateGlossaryTermDto: ...,
  } satisfies GlossaryControllerDeprecateRequest;

  try {
    const data = await api.glossaryControllerDeprecate(body);
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
| **deprecateGlossaryTermDto** | [DeprecateGlossaryTermDto](DeprecateGlossaryTermDto.md) |  | |

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


## glossaryControllerExport

> glossaryControllerExport(schemeId, kinds, baseUrl)

Export as CSV or SKOS JSON-LD

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerExportRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // string
    schemeId: schemeId_example,
    // string
    kinds: kinds_example,
    // string
    baseUrl: baseUrl_example,
  } satisfies GlossaryControllerExportRequest;

  try {
    const data = await api.glossaryControllerExport(body);
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
| **schemeId** | `string` |  | [Defaults to `undefined`] |
| **kinds** | `string` |  | [Defaults to `undefined`] |
| **baseUrl** | `string` |  | [Defaults to `undefined`] |

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


## glossaryControllerGetScheme

> GlossarySchemeDto glossaryControllerGetScheme(id)



### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerGetSchemeRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // string
    id: id_example,
  } satisfies GlossaryControllerGetSchemeRequest;

  try {
    const data = await api.glossaryControllerGetScheme(body);
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

[**GlossarySchemeDto**](GlossarySchemeDto.md)

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


## glossaryControllerGetTerm

> glossaryControllerGetTerm(idOrKey)

A term by id or key (old keys resolve): scheme, relations, broader chain, narrower list

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerGetTermRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // string
    idOrKey: idOrKey_example,
  } satisfies GlossaryControllerGetTermRequest;

  try {
    const data = await api.glossaryControllerGetTerm(body);
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
| **idOrKey** | `string` |  | [Defaults to `undefined`] |

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


## glossaryControllerImport

> glossaryControllerImport(glossaryImportDto)

Import CSV or SKOS JSON-LD. Defaults to a dry run that reports creates, updates, skips, conflicts and refusals.

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerImportRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // GlossaryImportDto
    glossaryImportDto: ...,
  } satisfies GlossaryControllerImportRequest;

  try {
    const data = await api.glossaryControllerImport(body);
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
| **glossaryImportDto** | [GlossaryImportDto](GlossaryImportDto.md) |  | |

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


## glossaryControllerImportJob

> glossaryControllerImportJob(jobId)

An import report

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerImportJobRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // string
    jobId: jobId_example,
  } satisfies GlossaryControllerImportJobRequest;

  try {
    const data = await api.glossaryControllerImportJob(body);
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
| **jobId** | `string` |  | [Defaults to `undefined`] |

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


## glossaryControllerList

> GlossaryListResponseDto glossaryControllerList(query, entityType, kind, schemeId, schemeKey, status, steward, take, skip)

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
    // string | Free-text filter over term, key, aliases, codes, definition and notes. (optional)
    query: query_example,
    // 'PERSON' | 'ORGANIZATION' | 'LOCATION' | 'REFERENCE' | 'TERM' | 'OTHER' (optional)
    entityType: entityType_example,
    // 'CONCEPT' | 'ENTITY' (optional)
    kind: kind_example,
    // string | Scheme id, or \"none\" for terms without a scheme. (optional)
    schemeId: schemeId_example,
    // string (optional)
    schemeKey: schemeKey_example,
    // string | Comma-separated statuses (DRAFT, APPROVED, DEPRECATED). (optional)
    status: status_example,
    // string (optional)
    steward: steward_example,
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
| **query** | `string` | Free-text filter over term, key, aliases, codes, definition and notes. | [Optional] [Defaults to `undefined`] |
| **entityType** | `PERSON`, `ORGANIZATION`, `LOCATION`, `REFERENCE`, `TERM`, `OTHER` |  | [Optional] [Defaults to `undefined`] [Enum: PERSON, ORGANIZATION, LOCATION, REFERENCE, TERM, OTHER] |
| **kind** | `CONCEPT`, `ENTITY` |  | [Optional] [Defaults to `undefined`] [Enum: CONCEPT, ENTITY] |
| **schemeId** | `string` | Scheme id, or \&quot;none\&quot; for terms without a scheme. | [Optional] [Defaults to `undefined`] |
| **schemeKey** | `string` |  | [Optional] [Defaults to `undefined`] |
| **status** | `string` | Comma-separated statuses (DRAFT, APPROVED, DEPRECATED). | [Optional] [Defaults to `undefined`] |
| **steward** | `string` |  | [Optional] [Defaults to `undefined`] |
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


## glossaryControllerListRelations

> glossaryControllerListRelations(termId, type, status, take, skip)

List relations

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerListRelationsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // string
    termId: termId_example,
    // string
    type: type_example,
    // string
    status: status_example,
    // string
    take: take_example,
    // string
    skip: skip_example,
  } satisfies GlossaryControllerListRelationsRequest;

  try {
    const data = await api.glossaryControllerListRelations(body);
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
| **termId** | `string` |  | [Defaults to `undefined`] |
| **type** | `string` |  | [Defaults to `undefined`] |
| **status** | `string` |  | [Defaults to `undefined`] |
| **take** | `string` |  | [Defaults to `undefined`] |
| **skip** | `string` |  | [Defaults to `undefined`] |

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


## glossaryControllerListSchemes

> Array&lt;GlossarySchemeDto&gt; glossaryControllerListSchemes()

List schemes with term counts

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerListSchemesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  try {
    const data = await api.glossaryControllerListSchemes();
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

[**Array&lt;GlossarySchemeDto&gt;**](GlossarySchemeDto.md)

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

> Array&lt;GlossaryLookupHitDto&gt; glossaryControllerLookup(query, limit, kind, schemeId, schemeKey, status, includeDeprecated)

Resolve a name, alias, code or hidden alias to glossary terms (exact, prefix, substring, semantic)

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
    // string | Name, alias, code or hidden alias to resolve.
    query: query_example,
    // number (optional)
    limit: 8.14,
    // 'CONCEPT' | 'ENTITY' (optional)
    kind: kind_example,
    // string (optional)
    schemeId: schemeId_example,
    // string (optional)
    schemeKey: schemeKey_example,
    // string | Comma-separated statuses; default DRAFT,APPROVED. (optional)
    status: status_example,
    // string (optional)
    includeDeprecated: includeDeprecated_example,
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
| **query** | `string` | Name, alias, code or hidden alias to resolve. | [Defaults to `undefined`] |
| **limit** | `number` |  | [Optional] [Defaults to `10`] |
| **kind** | `CONCEPT`, `ENTITY` |  | [Optional] [Defaults to `undefined`] [Enum: CONCEPT, ENTITY] |
| **schemeId** | `string` |  | [Optional] [Defaults to `undefined`] |
| **schemeKey** | `string` |  | [Optional] [Defaults to `undefined`] |
| **status** | `string` | Comma-separated statuses; default DRAFT,APPROVED. | [Optional] [Defaults to `undefined`] |
| **includeDeprecated** | `string` |  | [Optional] [Defaults to `undefined`] |

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


## glossaryControllerReinstate

> GlossaryTermDto glossaryControllerReinstate(id)

DEPRECATED → APPROVED

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerReinstateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // string
    id: id_example,
  } satisfies GlossaryControllerReinstateRequest;

  try {
    const data = await api.glossaryControllerReinstate(body);
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

[**GlossaryTermDto**](GlossaryTermDto.md)

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

Delete a glossary term (deletion is remembered)

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


## glossaryControllerRemoveRelation

> glossaryControllerRemoveRelation(id)



### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerRemoveRelationRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // string
    id: id_example,
  } satisfies GlossaryControllerRemoveRelationRequest;

  try {
    const data = await api.glossaryControllerRemoveRelation(body);
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


## glossaryControllerTree

> glossaryControllerTree(id, parentId)

One level of a scheme taxonomy: roots, or the narrower concepts of parentId

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerTreeRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // string
    id: id_example,
    // string
    parentId: parentId_example,
  } satisfies GlossaryControllerTreeRequest;

  try {
    const data = await api.glossaryControllerTree(body);
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
| **parentId** | `string` |  | [Defaults to `undefined`] |

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


## glossaryControllerUnapprove

> GlossaryTermDto glossaryControllerUnapprove(id)

APPROVED → DRAFT

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerUnapproveRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // string
    id: id_example,
  } satisfies GlossaryControllerUnapproveRequest;

  try {
    const data = await api.glossaryControllerUnapprove(body);
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

[**GlossaryTermDto**](GlossaryTermDto.md)

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


## glossaryControllerUpdateScheme

> GlossarySchemeDto glossaryControllerUpdateScheme(id, upsertGlossarySchemeDto)

Edit a scheme

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossaryControllerUpdateSchemeRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // string
    id: id_example,
    // UpsertGlossarySchemeDto
    upsertGlossarySchemeDto: ...,
  } satisfies GlossaryControllerUpdateSchemeRequest;

  try {
    const data = await api.glossaryControllerUpdateScheme(body);
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
| **upsertGlossarySchemeDto** | [UpsertGlossarySchemeDto](UpsertGlossarySchemeDto.md) |  | |

### Return type

[**GlossarySchemeDto**](GlossarySchemeDto.md)

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


## glossarySemanticControllerCounts

> glossarySemanticControllerCounts()

Pending proposals by kind, for the badge

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossarySemanticControllerCountsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  try {
    const data = await api.glossarySemanticControllerCounts();
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


## glossarySemanticControllerDecide

> glossarySemanticControllerDecide()

Accept, edit and accept, dismiss, dismiss forever or skip one proposal

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossarySemanticControllerDecideRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  try {
    const data = await api.glossarySemanticControllerDecide();
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


## glossarySemanticControllerDecideBulk

> glossarySemanticControllerDecideBulk()

Bulk accept or dismiss a group of document (LINK) suggestions

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossarySemanticControllerDecideBulkRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  try {
    const data = await api.glossarySemanticControllerDecideBulk();
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


## glossarySemanticControllerFindInTextCreate

> glossarySemanticControllerFindInTextCreate(idOrKey)

\&quot;Find in text\&quot;: create a tested REGEX detector bound to the term

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossarySemanticControllerFindInTextCreateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // string
    idOrKey: idOrKey_example,
  } satisfies GlossarySemanticControllerFindInTextCreateRequest;

  try {
    const data = await api.glossarySemanticControllerFindInTextCreate(body);
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
| **idOrKey** | `string` |  | [Defaults to `undefined`] |

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


## glossarySemanticControllerFindInTextPreview

> glossarySemanticControllerFindInTextPreview(idOrKey)

\&quot;Find in text\&quot;: the labels, pattern and tests a detector would get

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossarySemanticControllerFindInTextPreviewRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // string
    idOrKey: idOrKey_example,
  } satisfies GlossarySemanticControllerFindInTextPreviewRequest;

  try {
    const data = await api.glossarySemanticControllerFindInTextPreview(body);
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
| **idOrKey** | `string` |  | [Defaults to `undefined`] |

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


## glossarySemanticControllerFindInTextPreviewWith

> glossarySemanticControllerFindInTextPreviewWith(idOrKey)



### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossarySemanticControllerFindInTextPreviewWithRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // string
    idOrKey: idOrKey_example,
  } satisfies GlossarySemanticControllerFindInTextPreviewWithRequest;

  try {
    const data = await api.glossarySemanticControllerFindInTextPreviewWith(body);
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
| **idOrKey** | `string` |  | [Defaults to `undefined`] |

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


## glossarySemanticControllerFindInTextStatus

> glossarySemanticControllerFindInTextStatus(idOrKey)

Detectors generated from a term, with out-of-date flags

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossarySemanticControllerFindInTextStatusRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // string
    idOrKey: idOrKey_example,
  } satisfies GlossarySemanticControllerFindInTextStatusRequest;

  try {
    const data = await api.glossarySemanticControllerFindInTextStatus(body);
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
| **idOrKey** | `string` |  | [Defaults to `undefined`] |

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


## glossarySemanticControllerLinkGroups

> glossarySemanticControllerLinkGroups()

Document suggestions grouped per concept, with a score histogram

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossarySemanticControllerLinkGroupsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  try {
    const data = await api.glossarySemanticControllerLinkGroups();
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


## glossarySemanticControllerList

> glossarySemanticControllerList(kind, origin, schemeId, termId, minScore, take, skip)

The review queue: every proposal, one paged list

### Example

```ts
import {
  Configuration,
  GlossaryApi,
} from '@workspace/api-client';
import type { GlossarySemanticControllerListRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new GlossaryApi();

  const body = {
    // string
    kind: kind_example,
    // string
    origin: origin_example,
    // string
    schemeId: schemeId_example,
    // string
    termId: termId_example,
    // string
    minScore: minScore_example,
    // string
    take: take_example,
    // string
    skip: skip_example,
  } satisfies GlossarySemanticControllerListRequest;

  try {
    const data = await api.glossarySemanticControllerList(body);
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
| **kind** | `string` |  | [Defaults to `undefined`] |
| **origin** | `string` |  | [Defaults to `undefined`] |
| **schemeId** | `string` |  | [Defaults to `undefined`] |
| **termId** | `string` |  | [Defaults to `undefined`] |
| **minScore** | `string` |  | [Defaults to `undefined`] |
| **take** | `string` |  | [Defaults to `undefined`] |
| **skip** | `string` |  | [Defaults to `undefined`] |

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

