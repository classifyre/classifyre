# SemanticApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**semanticControllerApproveBinding**](SemanticApi.md#semanticcontrollerapprovebinding) | **POST** /semantic/bindings/{id}/approve |  |
| [**semanticControllerAssetMeaning**](SemanticApi.md#semanticcontrollerassetmeaning) | **GET** /semantic/assets/{assetId}/meaning | An asset\&#39;s current links, grouped by term; GONE links with history&#x3D;true |
| [**semanticControllerAssetTermEvidence**](SemanticApi.md#semanticcontrollerassettermevidence) | **GET** /semantic/assets/{assetId}/terms/{termId}/evidence | Why this asset is about this term |
| [**semanticControllerCaseLinks**](SemanticApi.md#semanticcontrollercaselinks) | **GET** /semantic/cases/{caseId}/links | Terms a case is about (case ABOUT links) |
| [**semanticControllerCoverage**](SemanticApi.md#semanticcontrollercoverage) | **GET** /semantic/coverage | Semantic coverage: the share of open findings that carry a meaning |
| [**semanticControllerCreateBinding**](SemanticApi.md#semanticcontrollercreatebinding) | **POST** /semantic/bindings | Create a binding (APPROVED for operators unless status DRAFT) |
| [**semanticControllerDeleteBinding**](SemanticApi.md#semanticcontrollerdeletebinding) | **DELETE** /semantic/bindings/{id} | Delete a DRAFT or DISABLED binding |
| [**semanticControllerDisableBinding**](SemanticApi.md#semanticcontrollerdisablebinding) | **POST** /semantic/bindings/{id}/disable |  |
| [**semanticControllerEnableBinding**](SemanticApi.md#semanticcontrollerenablebinding) | **POST** /semantic/bindings/{id}/enable |  |
| [**semanticControllerFindingMeaning**](SemanticApi.md#semanticcontrollerfindingmeaning) | **GET** /semantic/findings/{findingId}/meaning | What a finding means: bindings evaluated, manual links, broader concepts (C11) |
| [**semanticControllerGetBinding**](SemanticApi.md#semanticcontrollergetbinding) | **GET** /semantic/bindings/{id} |  |
| [**semanticControllerInstallPack**](SemanticApi.md#semanticcontrollerinstallpack) | **POST** /semantic/packs/install | Install a pack (dry run by default) |
| [**semanticControllerLink**](SemanticApi.md#semanticcontrollerlink) | **POST** /semantic/links | Link a finding, asset or case to a term (MANUAL) |
| [**semanticControllerLinkerJobs**](SemanticApi.md#semanticcontrollerlinkerjobs) | **GET** /semantic/linker/jobs | Recent linker jobs with progress |
| [**semanticControllerListBindings**](SemanticApi.md#semanticcontrollerlistbindings) | **GET** /semantic/bindings | List bindings |
| [**semanticControllerListPacks**](SemanticApi.md#semanticcontrollerlistpacks) | **GET** /semantic/packs | Installed packs and the bundled starter packs |
| [**semanticControllerMapTerm**](SemanticApi.md#semanticcontrollermapterm) | **GET** /semantic/map/terms/{termId} | The map rail for one concept |
| [**semanticControllerPreview**](SemanticApi.md#semanticcontrollerpreview) | **POST** /semantic/bindings/preview | Preview a binding: counts, samples, the lookup table, warnings |
| [**semanticControllerRebuild**](SemanticApi.md#semanticcontrollerrebuild) | **POST** /semantic/linker/rebuild | Rebuild every semantic link (backfill over all bindings) |
| [**semanticControllerRebuildMap**](SemanticApi.md#semanticcontrollerrebuildmap) | **POST** /semantic/map/rebuild |  |
| [**semanticControllerReconcile**](SemanticApi.md#semanticcontrollerreconcile) | **POST** /semantic/linker/reconcile | Compare a sample of the rollup with a recomputation and repair drift |
| [**semanticControllerRefreshSuggestions**](SemanticApi.md#semanticcontrollerrefreshsuggestions) | **POST** /semantic/suggestions/refresh | Run the suggestion generators (queued) |
| [**semanticControllerRetargetBinding**](SemanticApi.md#semanticcontrollerretargetbinding) | **POST** /semantic/bindings/{id}/retarget | Aim a binding at its deprecated concept\&#39;s successor |
| [**semanticControllerSemanticMap**](SemanticApi.md#semanticcontrollersemanticmap) | **GET** /semantic/map | The semantic map: concepts, relations, co-occurrence, overlay |
| [**semanticControllerSuggestionSettings**](SemanticApi.md#semanticcontrollersuggestionsettings) | **GET** /semantic/suggestions/settings |  |
| [**semanticControllerSuggestionStats**](SemanticApi.md#semanticcontrollersuggestionstats) | **GET** /semantic/suggestions/stats | Acceptance rate per generator and score band |
| [**semanticControllerTermEvidence**](SemanticApi.md#semanticcontrollertermevidence) | **GET** /semantic/terms/{termId}/evidence | Assets linked to a term, by severity then support |
| [**semanticControllerTermRefs**](SemanticApi.md#semanticcontrollertermrefs) | **GET** /semantic/term-refs | Unknown term references declared by connectors |
| [**semanticControllerTermSummary**](SemanticApi.md#semanticcontrollertermsummary) | **GET** /semantic/terms/{termId}/summary | Counts by method, source and severity, and a weekly trend |
| [**semanticControllerTermUsage**](SemanticApi.md#semanticcontrollertermusage) | **GET** /semantic/terms/{termId}/usage | Cases and watches that use a term |
| [**semanticControllerUninstallPack**](SemanticApi.md#semanticcontrolleruninstallpack) | **DELETE** /semantic/packs/{key} | Uninstall a pack: untouched items go, edited ones are detached |
| [**semanticControllerUnlink**](SemanticApi.md#semanticcontrollerunlink) | **DELETE** /semantic/links/{referenceId} |  |
| [**semanticControllerUpdateBinding**](SemanticApi.md#semanticcontrollerupdatebinding) | **PATCH** /semantic/bindings/{id} | Edit a DRAFT binding |
| [**semanticControllerUpdateSuggestionSettings**](SemanticApi.md#semanticcontrollerupdatesuggestionsettings) | **PATCH** /semantic/suggestions/settings |  |
| [**semanticControllerUpgradePack**](SemanticApi.md#semanticcontrollerupgradepack) | **POST** /semantic/packs/{key}/upgrade |  |
| [**semanticControllerVocabularyList**](SemanticApi.md#semanticcontrollervocabularylist) | **GET** /semantic/vocabulary | The observed vocabulary: detector outputs and metadata fields, with counts and bindings |
| [**semanticControllerVocabularyRefresh**](SemanticApi.md#semanticcontrollervocabularyrefresh) | **POST** /semantic/vocabulary/refresh | Queue a vocabulary refresh (one source, or all) |
| [**semanticControllerVocabularyValues**](SemanticApi.md#semanticcontrollervocabularyvalues) | **GET** /semantic/vocabulary/values | Top observed values with counts, for the binding dialog |



## semanticControllerApproveBinding

> semanticControllerApproveBinding(id)



### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerApproveBindingRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    id: id_example,
  } satisfies SemanticControllerApproveBindingRequest;

  try {
    const data = await api.semanticControllerApproveBinding(body);
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


## semanticControllerAssetMeaning

> semanticControllerAssetMeaning(assetId, history)

An asset\&#39;s current links, grouped by term; GONE links with history&#x3D;true

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerAssetMeaningRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    assetId: assetId_example,
    // string
    history: history_example,
  } satisfies SemanticControllerAssetMeaningRequest;

  try {
    const data = await api.semanticControllerAssetMeaning(body);
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
| **assetId** | `string` |  | [Defaults to `undefined`] |
| **history** | `string` |  | [Defaults to `undefined`] |

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


## semanticControllerAssetTermEvidence

> semanticControllerAssetTermEvidence(assetId, termId, page)

Why this asset is about this term

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerAssetTermEvidenceRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    assetId: assetId_example,
    // string
    termId: termId_example,
    // string
    page: page_example,
  } satisfies SemanticControllerAssetTermEvidenceRequest;

  try {
    const data = await api.semanticControllerAssetTermEvidence(body);
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
| **assetId** | `string` |  | [Defaults to `undefined`] |
| **termId** | `string` |  | [Defaults to `undefined`] |
| **page** | `string` |  | [Defaults to `undefined`] |

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


## semanticControllerCaseLinks

> semanticControllerCaseLinks(caseId)

Terms a case is about (case ABOUT links)

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerCaseLinksRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    caseId: caseId_example,
  } satisfies SemanticControllerCaseLinksRequest;

  try {
    const data = await api.semanticControllerCaseLinks(body);
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


## semanticControllerCoverage

> semanticControllerCoverage(days)

Semantic coverage: the share of open findings that carry a meaning

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerCoverageRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    days: days_example,
  } satisfies SemanticControllerCoverageRequest;

  try {
    const data = await api.semanticControllerCoverage(body);
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
| **days** | `string` |  | [Defaults to `undefined`] |

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


## semanticControllerCreateBinding

> semanticControllerCreateBinding()

Create a binding (APPROVED for operators unless status DRAFT)

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerCreateBindingRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  try {
    const data = await api.semanticControllerCreateBinding();
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
| **201** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## semanticControllerDeleteBinding

> semanticControllerDeleteBinding(id)

Delete a DRAFT or DISABLED binding

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerDeleteBindingRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    id: id_example,
  } satisfies SemanticControllerDeleteBindingRequest;

  try {
    const data = await api.semanticControllerDeleteBinding(body);
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


## semanticControllerDisableBinding

> semanticControllerDisableBinding(id)



### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerDisableBindingRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    id: id_example,
  } satisfies SemanticControllerDisableBindingRequest;

  try {
    const data = await api.semanticControllerDisableBinding(body);
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


## semanticControllerEnableBinding

> semanticControllerEnableBinding(id)



### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerEnableBindingRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    id: id_example,
  } satisfies SemanticControllerEnableBindingRequest;

  try {
    const data = await api.semanticControllerEnableBinding(body);
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


## semanticControllerFindingMeaning

> semanticControllerFindingMeaning(findingId)

What a finding means: bindings evaluated, manual links, broader concepts (C11)

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerFindingMeaningRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    findingId: findingId_example,
  } satisfies SemanticControllerFindingMeaningRequest;

  try {
    const data = await api.semanticControllerFindingMeaning(body);
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
| **findingId** | `string` |  | [Defaults to `undefined`] |

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


## semanticControllerGetBinding

> semanticControllerGetBinding(id)



### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerGetBindingRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    id: id_example,
  } satisfies SemanticControllerGetBindingRequest;

  try {
    const data = await api.semanticControllerGetBinding(body);
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


## semanticControllerInstallPack

> semanticControllerInstallPack()

Install a pack (dry run by default)

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerInstallPackRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  try {
    const data = await api.semanticControllerInstallPack();
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


## semanticControllerLink

> semanticControllerLink()

Link a finding, asset or case to a term (MANUAL)

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerLinkRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  try {
    const data = await api.semanticControllerLink();
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
| **201** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## semanticControllerLinkerJobs

> semanticControllerLinkerJobs(limit)

Recent linker jobs with progress

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerLinkerJobsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    limit: limit_example,
  } satisfies SemanticControllerLinkerJobsRequest;

  try {
    const data = await api.semanticControllerLinkerJobs(body);
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
| **limit** | `string` |  | [Defaults to `undefined`] |

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


## semanticControllerListBindings

> semanticControllerListBindings(termId, status, origin, detectorType, customDetectorKey, findingType, schemeId, take, skip)

List bindings

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerListBindingsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    termId: termId_example,
    // string
    status: status_example,
    // string
    origin: origin_example,
    // string
    detectorType: detectorType_example,
    // string
    customDetectorKey: customDetectorKey_example,
    // string
    findingType: findingType_example,
    // string
    schemeId: schemeId_example,
    // string
    take: take_example,
    // string
    skip: skip_example,
  } satisfies SemanticControllerListBindingsRequest;

  try {
    const data = await api.semanticControllerListBindings(body);
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
| **status** | `string` |  | [Defaults to `undefined`] |
| **origin** | `string` |  | [Defaults to `undefined`] |
| **detectorType** | `string` |  | [Defaults to `undefined`] |
| **customDetectorKey** | `string` |  | [Defaults to `undefined`] |
| **findingType** | `string` |  | [Defaults to `undefined`] |
| **schemeId** | `string` |  | [Defaults to `undefined`] |
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


## semanticControllerListPacks

> semanticControllerListPacks()

Installed packs and the bundled starter packs

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerListPacksRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  try {
    const data = await api.semanticControllerListPacks();
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


## semanticControllerMapTerm

> semanticControllerMapTerm(termId)

The map rail for one concept

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerMapTermRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    termId: termId_example,
  } satisfies SemanticControllerMapTermRequest;

  try {
    const data = await api.semanticControllerMapTerm(body);
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


## semanticControllerPreview

> semanticControllerPreview()

Preview a binding: counts, samples, the lookup table, warnings

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerPreviewRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  try {
    const data = await api.semanticControllerPreview();
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


## semanticControllerRebuild

> semanticControllerRebuild()

Rebuild every semantic link (backfill over all bindings)

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerRebuildRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  try {
    const data = await api.semanticControllerRebuild();
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
| **202** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## semanticControllerRebuildMap

> semanticControllerRebuildMap()



### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerRebuildMapRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  try {
    const data = await api.semanticControllerRebuildMap();
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
| **202** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## semanticControllerReconcile

> semanticControllerReconcile()

Compare a sample of the rollup with a recomputation and repair drift

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerReconcileRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  try {
    const data = await api.semanticControllerReconcile();
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
| **202** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## semanticControllerRefreshSuggestions

> semanticControllerRefreshSuggestions()

Run the suggestion generators (queued)

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerRefreshSuggestionsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  try {
    const data = await api.semanticControllerRefreshSuggestions();
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
| **202** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## semanticControllerRetargetBinding

> semanticControllerRetargetBinding(id)

Aim a binding at its deprecated concept\&#39;s successor

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerRetargetBindingRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    id: id_example,
  } satisfies SemanticControllerRetargetBindingRequest;

  try {
    const data = await api.semanticControllerRetargetBinding(body);
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


## semanticControllerSemanticMap

> semanticControllerSemanticMap(schemeIds, sourceIds, minAssets, cooccurrence, caseId, entities)

The semantic map: concepts, relations, co-occurrence, overlay

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerSemanticMapRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    schemeIds: schemeIds_example,
    // string
    sourceIds: sourceIds_example,
    // string
    minAssets: minAssets_example,
    // string
    cooccurrence: cooccurrence_example,
    // string
    caseId: caseId_example,
    // string
    entities: entities_example,
  } satisfies SemanticControllerSemanticMapRequest;

  try {
    const data = await api.semanticControllerSemanticMap(body);
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
| **schemeIds** | `string` |  | [Defaults to `undefined`] |
| **sourceIds** | `string` |  | [Defaults to `undefined`] |
| **minAssets** | `string` |  | [Defaults to `undefined`] |
| **cooccurrence** | `string` |  | [Defaults to `undefined`] |
| **caseId** | `string` |  | [Defaults to `undefined`] |
| **entities** | `string` |  | [Defaults to `undefined`] |

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


## semanticControllerSuggestionSettings

> semanticControllerSuggestionSettings()



### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerSuggestionSettingsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  try {
    const data = await api.semanticControllerSuggestionSettings();
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


## semanticControllerSuggestionStats

> semanticControllerSuggestionStats(days)

Acceptance rate per generator and score band

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerSuggestionStatsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    days: days_example,
  } satisfies SemanticControllerSuggestionStatsRequest;

  try {
    const data = await api.semanticControllerSuggestionStats(body);
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
| **days** | `string` |  | [Defaults to `undefined`] |

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


## semanticControllerTermEvidence

> semanticControllerTermEvidence(termId, includeNarrower, sourceId, method, status, page, pageSize)

Assets linked to a term, by severity then support

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerTermEvidenceRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    termId: termId_example,
    // string
    includeNarrower: includeNarrower_example,
    // string
    sourceId: sourceId_example,
    // string
    method: method_example,
    // string
    status: status_example,
    // string
    page: page_example,
    // string
    pageSize: pageSize_example,
  } satisfies SemanticControllerTermEvidenceRequest;

  try {
    const data = await api.semanticControllerTermEvidence(body);
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
| **includeNarrower** | `string` |  | [Defaults to `undefined`] |
| **sourceId** | `string` |  | [Defaults to `undefined`] |
| **method** | `string` |  | [Defaults to `undefined`] |
| **status** | `string` |  | [Defaults to `undefined`] |
| **page** | `string` |  | [Defaults to `undefined`] |
| **pageSize** | `string` |  | [Defaults to `undefined`] |

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


## semanticControllerTermRefs

> semanticControllerTermRefs(limit)

Unknown term references declared by connectors

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerTermRefsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    limit: limit_example,
  } satisfies SemanticControllerTermRefsRequest;

  try {
    const data = await api.semanticControllerTermRefs(body);
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
| **limit** | `string` |  | [Defaults to `undefined`] |

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


## semanticControllerTermSummary

> semanticControllerTermSummary(termId, includeNarrower)

Counts by method, source and severity, and a weekly trend

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerTermSummaryRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    termId: termId_example,
    // string
    includeNarrower: includeNarrower_example,
  } satisfies SemanticControllerTermSummaryRequest;

  try {
    const data = await api.semanticControllerTermSummary(body);
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
| **includeNarrower** | `string` |  | [Defaults to `undefined`] |

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


## semanticControllerTermUsage

> semanticControllerTermUsage(termId)

Cases and watches that use a term

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerTermUsageRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    termId: termId_example,
  } satisfies SemanticControllerTermUsageRequest;

  try {
    const data = await api.semanticControllerTermUsage(body);
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


## semanticControllerUninstallPack

> semanticControllerUninstallPack(key, dryRun)

Uninstall a pack: untouched items go, edited ones are detached

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerUninstallPackRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    key: key_example,
    // string
    dryRun: dryRun_example,
  } satisfies SemanticControllerUninstallPackRequest;

  try {
    const data = await api.semanticControllerUninstallPack(body);
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
| **key** | `string` |  | [Defaults to `undefined`] |
| **dryRun** | `string` |  | [Defaults to `undefined`] |

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


## semanticControllerUnlink

> semanticControllerUnlink(referenceId)



### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerUnlinkRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    referenceId: referenceId_example,
  } satisfies SemanticControllerUnlinkRequest;

  try {
    const data = await api.semanticControllerUnlink(body);
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
| **referenceId** | `string` |  | [Defaults to `undefined`] |

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


## semanticControllerUpdateBinding

> semanticControllerUpdateBinding(id)

Edit a DRAFT binding

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerUpdateBindingRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    id: id_example,
  } satisfies SemanticControllerUpdateBindingRequest;

  try {
    const data = await api.semanticControllerUpdateBinding(body);
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


## semanticControllerUpdateSuggestionSettings

> semanticControllerUpdateSuggestionSettings()



### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerUpdateSuggestionSettingsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  try {
    const data = await api.semanticControllerUpdateSuggestionSettings();
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


## semanticControllerUpgradePack

> semanticControllerUpgradePack(key)



### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerUpgradePackRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    key: key_example,
  } satisfies SemanticControllerUpgradePackRequest;

  try {
    const data = await api.semanticControllerUpgradePack(body);
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
| **key** | `string` |  | [Defaults to `undefined`] |

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


## semanticControllerVocabularyList

> semanticControllerVocabularyList(kind, sourceId, detectorType, customDetectorKey, bound, q, take, skip)

The observed vocabulary: detector outputs and metadata fields, with counts and bindings

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerVocabularyListRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    kind: kind_example,
    // string
    sourceId: sourceId_example,
    // string
    detectorType: detectorType_example,
    // string
    customDetectorKey: customDetectorKey_example,
    // string
    bound: bound_example,
    // string
    q: q_example,
    // string
    take: take_example,
    // string
    skip: skip_example,
  } satisfies SemanticControllerVocabularyListRequest;

  try {
    const data = await api.semanticControllerVocabularyList(body);
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
| **sourceId** | `string` |  | [Defaults to `undefined`] |
| **detectorType** | `string` |  | [Defaults to `undefined`] |
| **customDetectorKey** | `string` |  | [Defaults to `undefined`] |
| **bound** | `string` |  | [Defaults to `undefined`] |
| **q** | `string` |  | [Defaults to `undefined`] |
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


## semanticControllerVocabularyRefresh

> semanticControllerVocabularyRefresh()

Queue a vocabulary refresh (one source, or all)

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerVocabularyRefreshRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  try {
    const data = await api.semanticControllerVocabularyRefresh();
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
| **202** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## semanticControllerVocabularyValues

> semanticControllerVocabularyValues(detectorType, customDetectorKey, findingType, field, sourceIds, limit)

Top observed values with counts, for the binding dialog

### Example

```ts
import {
  Configuration,
  SemanticApi,
} from '@workspace/api-client';
import type { SemanticControllerVocabularyValuesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticApi();

  const body = {
    // string
    detectorType: detectorType_example,
    // string
    customDetectorKey: customDetectorKey_example,
    // string
    findingType: findingType_example,
    // string
    field: field_example,
    // string
    sourceIds: sourceIds_example,
    // string
    limit: limit_example,
  } satisfies SemanticControllerVocabularyValuesRequest;

  try {
    const data = await api.semanticControllerVocabularyValues(body);
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
| **detectorType** | `string` |  | [Defaults to `undefined`] |
| **customDetectorKey** | `string` |  | [Defaults to `undefined`] |
| **findingType** | `string` |  | [Defaults to `undefined`] |
| **field** | `string` |  | [Defaults to `undefined`] |
| **sourceIds** | `string` |  | [Defaults to `undefined`] |
| **limit** | `string` |  | [Defaults to `undefined`] |

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

