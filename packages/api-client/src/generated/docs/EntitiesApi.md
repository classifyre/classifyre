# EntitiesApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**entitiesControllerAddValue**](EntitiesApi.md#entitiescontrolleraddvalue) | **POST** /entities/{idOrKey}/values | Add an identifier (or promote an indexed value). A value another entity holds becomes a conflict to review |
| [**entitiesControllerCoMentions**](EntitiesApi.md#entitiescontrollercomentions) | **GET** /entities/{idOrKey}/co-mentions | Entities that appear in the same assets |
| [**entitiesControllerConfig**](EntitiesApi.md#entitiescontrollerconfig) | **GET** /entities/config | The Entities switch and which labels take part in resolution (names, identifiers) |
| [**entitiesControllerCreate**](EntitiesApi.md#entitiescontrollercreate) | **POST** /entities | Create an entity, optionally from a finding or an indexed value (\&quot;Make entity\&quot;) |
| [**entitiesControllerExport**](EntitiesApi.md#entitiescontrollerexport) | **GET** /entities/{idOrKey}/export | Export mentions as CSV or JSON: \&quot;what do we hold about this person\&quot; (access request) |
| [**entitiesControllerGet**](EntitiesApi.md#entitiescontrollerget) | **GET** /entities/{idOrKey} | An entity: values and identifiers, live counters, anchor record, pending candidates |
| [**entitiesControllerListCandidates**](EntitiesApi.md#entitiescontrollerlistcandidates) | **GET** /entities/candidates | The entity review queue: proposed values with scores and up to 3 occurrences each |
| [**entitiesControllerListMentions**](EntitiesApi.md#entitiescontrollerlistmentions) | **GET** /entities/{idOrKey}/mentions | Mentions of an entity across all sources (keyset-paged) |
| [**entitiesControllerMerge**](EntitiesApi.md#entitiescontrollermerge) | **POST** /entities/{idOrKey}/merge | Merge this entity into another: values, references and watches move, and it redirects |
| [**entitiesControllerOverview**](EntitiesApi.md#entitiescontrolleroverview) | **GET** /entities/{idOrKey}/overview | Mentions over time, sources, and the entities most often mentioned with this one |
| [**entitiesControllerRemoveValue**](EntitiesApi.md#entitiescontrollerremovevalue) | **DELETE** /entities/values/{valueId} | Remove an identifier or a confirmed value |
| [**entitiesControllerResolve**](EntitiesApi.md#entitiescontrollerresolve) | **POST** /entities/resolve | Queue a full resolution pass: alias values, candidates over the whole index, counters |
| [**entitiesControllerReview**](EntitiesApi.md#entitiescontrollerreview) | **POST** /entities/candidates/review | Accept or reject candidates (batch). A rejection is remembered; a conflict can also be moved |
| [**entitiesControllerSaveConfig**](EntitiesApi.md#entitiescontrollersaveconfig) | **PUT** /entities/config | Declare custom labels as names or identifiers; alias values are regenerated |
| [**entitiesControllerSearch**](EntitiesApi.md#entitiescontrollersearch) | **GET** /entities | Search entities by name, alias or identifier value, with mention counters |
| [**entitiesControllerUpdate**](EntitiesApi.md#entitiescontrollerupdate) | **PATCH** /entities/{idOrKey} | Set an entity\&#39;s anchor URN or attributes |



## entitiesControllerAddValue

> entitiesControllerAddValue(idOrKey)

Add an identifier (or promote an indexed value). A value another entity holds becomes a conflict to review

### Example

```ts
import {
  Configuration,
  EntitiesApi,
} from '@workspace/api-client';
import type { EntitiesControllerAddValueRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EntitiesApi();

  const body = {
    // string
    idOrKey: idOrKey_example,
  } satisfies EntitiesControllerAddValueRequest;

  try {
    const data = await api.entitiesControllerAddValue(body);
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


## entitiesControllerCoMentions

> entitiesControllerCoMentions(idOrKey, limit)

Entities that appear in the same assets

### Example

```ts
import {
  Configuration,
  EntitiesApi,
} from '@workspace/api-client';
import type { EntitiesControllerCoMentionsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EntitiesApi();

  const body = {
    // string
    idOrKey: idOrKey_example,
    // string
    limit: limit_example,
  } satisfies EntitiesControllerCoMentionsRequest;

  try {
    const data = await api.entitiesControllerCoMentions(body);
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


## entitiesControllerConfig

> entitiesControllerConfig()

The Entities switch and which labels take part in resolution (names, identifiers)

### Example

```ts
import {
  Configuration,
  EntitiesApi,
} from '@workspace/api-client';
import type { EntitiesControllerConfigRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EntitiesApi();

  try {
    const data = await api.entitiesControllerConfig();
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


## entitiesControllerCreate

> entitiesControllerCreate()

Create an entity, optionally from a finding or an indexed value (\&quot;Make entity\&quot;)

### Example

```ts
import {
  Configuration,
  EntitiesApi,
} from '@workspace/api-client';
import type { EntitiesControllerCreateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EntitiesApi();

  try {
    const data = await api.entitiesControllerCreate();
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


## entitiesControllerExport

> entitiesControllerExport(idOrKey, format)

Export mentions as CSV or JSON: \&quot;what do we hold about this person\&quot; (access request)

### Example

```ts
import {
  Configuration,
  EntitiesApi,
} from '@workspace/api-client';
import type { EntitiesControllerExportRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EntitiesApi();

  const body = {
    // string
    idOrKey: idOrKey_example,
    // string
    format: format_example,
  } satisfies EntitiesControllerExportRequest;

  try {
    const data = await api.entitiesControllerExport(body);
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
| **format** | `string` |  | [Defaults to `undefined`] |

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


## entitiesControllerGet

> entitiesControllerGet(idOrKey)

An entity: values and identifiers, live counters, anchor record, pending candidates

### Example

```ts
import {
  Configuration,
  EntitiesApi,
} from '@workspace/api-client';
import type { EntitiesControllerGetRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EntitiesApi();

  const body = {
    // string
    idOrKey: idOrKey_example,
  } satisfies EntitiesControllerGetRequest;

  try {
    const data = await api.entitiesControllerGet(body);
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


## entitiesControllerListCandidates

> entitiesControllerListCandidates(termId, kind, minScore, take, skip)

The entity review queue: proposed values with scores and up to 3 occurrences each

### Example

```ts
import {
  Configuration,
  EntitiesApi,
} from '@workspace/api-client';
import type { EntitiesControllerListCandidatesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EntitiesApi();

  const body = {
    // string
    termId: termId_example,
    // string
    kind: kind_example,
    // string
    minScore: minScore_example,
    // string
    take: take_example,
    // string
    skip: skip_example,
  } satisfies EntitiesControllerListCandidatesRequest;

  try {
    const data = await api.entitiesControllerListCandidates(body);
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
| **kind** | `string` |  | [Defaults to `undefined`] |
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


## entitiesControllerListMentions

> entitiesControllerListMentions(idOrKey, after, limit, sourceId)

Mentions of an entity across all sources (keyset-paged)

### Example

```ts
import {
  Configuration,
  EntitiesApi,
} from '@workspace/api-client';
import type { EntitiesControllerListMentionsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EntitiesApi();

  const body = {
    // string
    idOrKey: idOrKey_example,
    // string
    after: after_example,
    // string
    limit: limit_example,
    // string
    sourceId: sourceId_example,
  } satisfies EntitiesControllerListMentionsRequest;

  try {
    const data = await api.entitiesControllerListMentions(body);
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
| **after** | `string` |  | [Defaults to `undefined`] |
| **limit** | `string` |  | [Defaults to `undefined`] |
| **sourceId** | `string` |  | [Defaults to `undefined`] |

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


## entitiesControllerMerge

> entitiesControllerMerge(idOrKey)

Merge this entity into another: values, references and watches move, and it redirects

### Example

```ts
import {
  Configuration,
  EntitiesApi,
} from '@workspace/api-client';
import type { EntitiesControllerMergeRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EntitiesApi();

  const body = {
    // string
    idOrKey: idOrKey_example,
  } satisfies EntitiesControllerMergeRequest;

  try {
    const data = await api.entitiesControllerMerge(body);
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


## entitiesControllerOverview

> entitiesControllerOverview(idOrKey)

Mentions over time, sources, and the entities most often mentioned with this one

### Example

```ts
import {
  Configuration,
  EntitiesApi,
} from '@workspace/api-client';
import type { EntitiesControllerOverviewRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EntitiesApi();

  const body = {
    // string
    idOrKey: idOrKey_example,
  } satisfies EntitiesControllerOverviewRequest;

  try {
    const data = await api.entitiesControllerOverview(body);
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


## entitiesControllerRemoveValue

> entitiesControllerRemoveValue(valueId)

Remove an identifier or a confirmed value

### Example

```ts
import {
  Configuration,
  EntitiesApi,
} from '@workspace/api-client';
import type { EntitiesControllerRemoveValueRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EntitiesApi();

  const body = {
    // string
    valueId: valueId_example,
  } satisfies EntitiesControllerRemoveValueRequest;

  try {
    const data = await api.entitiesControllerRemoveValue(body);
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
| **valueId** | `string` |  | [Defaults to `undefined`] |

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


## entitiesControllerResolve

> entitiesControllerResolve()

Queue a full resolution pass: alias values, candidates over the whole index, counters

### Example

```ts
import {
  Configuration,
  EntitiesApi,
} from '@workspace/api-client';
import type { EntitiesControllerResolveRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EntitiesApi();

  try {
    const data = await api.entitiesControllerResolve();
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


## entitiesControllerReview

> entitiesControllerReview()

Accept or reject candidates (batch). A rejection is remembered; a conflict can also be moved

### Example

```ts
import {
  Configuration,
  EntitiesApi,
} from '@workspace/api-client';
import type { EntitiesControllerReviewRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EntitiesApi();

  try {
    const data = await api.entitiesControllerReview();
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


## entitiesControllerSaveConfig

> entitiesControllerSaveConfig()

Declare custom labels as names or identifiers; alias values are regenerated

### Example

```ts
import {
  Configuration,
  EntitiesApi,
} from '@workspace/api-client';
import type { EntitiesControllerSaveConfigRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EntitiesApi();

  try {
    const data = await api.entitiesControllerSaveConfig();
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


## entitiesControllerSearch

> entitiesControllerSearch(query, entityType, status, sort, take, skip)

Search entities by name, alias or identifier value, with mention counters

### Example

```ts
import {
  Configuration,
  EntitiesApi,
} from '@workspace/api-client';
import type { EntitiesControllerSearchRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EntitiesApi();

  const body = {
    // string
    query: query_example,
    // string
    entityType: entityType_example,
    // string
    status: status_example,
    // string
    sort: sort_example,
    // string
    take: take_example,
    // string
    skip: skip_example,
  } satisfies EntitiesControllerSearchRequest;

  try {
    const data = await api.entitiesControllerSearch(body);
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
| **query** | `string` |  | [Defaults to `undefined`] |
| **entityType** | `string` |  | [Defaults to `undefined`] |
| **status** | `string` |  | [Defaults to `undefined`] |
| **sort** | `string` |  | [Defaults to `undefined`] |
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


## entitiesControllerUpdate

> entitiesControllerUpdate(idOrKey)

Set an entity\&#39;s anchor URN or attributes

### Example

```ts
import {
  Configuration,
  EntitiesApi,
} from '@workspace/api-client';
import type { EntitiesControllerUpdateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new EntitiesApi();

  const body = {
    // string
    idOrKey: idOrKey_example,
  } satisfies EntitiesControllerUpdateRequest;

  try {
    const data = await api.entitiesControllerUpdate(body);
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

