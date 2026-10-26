# ExploreApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**exploreControllerCreateView**](ExploreApi.md#explorecontrollercreateview) | **POST** /explore/views | Save an Explore view |
| [**exploreControllerDeleteView**](ExploreApi.md#explorecontrollerdeleteview) | **DELETE** /explore/views/{id} | Delete a saved Explore view |
| [**exploreControllerFind**](ExploreApi.md#explorecontrollerfind) | **POST** /explore/find | Which of the assets on a canvas answer a question |
| [**exploreControllerGetView**](ExploreApi.md#explorecontrollergetview) | **GET** /explore/views/{id} | One saved Explore view |
| [**exploreControllerListViews**](ExploreApi.md#explorecontrollerlistviews) | **GET** /explore/views | Saved Explore views, the last changed first |
| [**exploreControllerNeighbourhood**](ExploreApi.md#explorecontrollerneighbourhood) | **POST** /explore/neighbourhood | What these assets are connected to, and why |
| [**exploreControllerStarters**](ExploreApi.md#explorecontrollerstarters) | **GET** /explore/starters | Where to start exploring |
| [**exploreControllerUpdateView**](ExploreApi.md#explorecontrollerupdateview) | **PATCH** /explore/views/{id} | Change a saved Explore view; what is left out stays |



## exploreControllerCreateView

> ExploreViewDto exploreControllerCreateView(saveExploreViewDto)

Save an Explore view

A name, the assets it starts from, how it is traced, and where people put things.

### Example

```ts
import {
  Configuration,
  ExploreApi,
} from '@workspace/api-client';
import type { ExploreControllerCreateViewRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new ExploreApi();

  const body = {
    // SaveExploreViewDto
    saveExploreViewDto: ...,
  } satisfies ExploreControllerCreateViewRequest;

  try {
    const data = await api.exploreControllerCreateView(body);
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
| **saveExploreViewDto** | [SaveExploreViewDto](SaveExploreViewDto.md) |  | |

### Return type

[**ExploreViewDto**](ExploreViewDto.md)

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


## exploreControllerDeleteView

> exploreControllerDeleteView(id)

Delete a saved Explore view

### Example

```ts
import {
  Configuration,
  ExploreApi,
} from '@workspace/api-client';
import type { ExploreControllerDeleteViewRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new ExploreApi();

  const body = {
    // string
    id: id_example,
  } satisfies ExploreControllerDeleteViewRequest;

  try {
    const data = await api.exploreControllerDeleteView(body);
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


## exploreControllerFind

> ExploreFindResponseDto exploreControllerFind(exploreFindRequestDto)

Which of the assets on a canvas answer a question

Reads only the assets given (what an Explore canvas shows): those whose name or a passage holds the words, then the rest by meaning, closest first. The few that stand out are marked lit.

### Example

```ts
import {
  Configuration,
  ExploreApi,
} from '@workspace/api-client';
import type { ExploreControllerFindRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new ExploreApi();

  const body = {
    // ExploreFindRequestDto
    exploreFindRequestDto: ...,
  } satisfies ExploreControllerFindRequest;

  try {
    const data = await api.exploreControllerFind(body);
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
| **exploreFindRequestDto** | [ExploreFindRequestDto](ExploreFindRequestDto.md) |  | |

### Return type

[**ExploreFindResponseDto**](ExploreFindResponseDto.md)

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


## exploreControllerGetView

> ExploreViewDto exploreControllerGetView(id)

One saved Explore view

### Example

```ts
import {
  Configuration,
  ExploreApi,
} from '@workspace/api-client';
import type { ExploreControllerGetViewRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new ExploreApi();

  const body = {
    // string
    id: id_example,
  } satisfies ExploreControllerGetViewRequest;

  try {
    const data = await api.exploreControllerGetView(body);
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

[**ExploreViewDto**](ExploreViewDto.md)

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


## exploreControllerListViews

> Array&lt;ExploreViewDto&gt; exploreControllerListViews()

Saved Explore views, the last changed first

Each with its starting points that still exist, by name: an asset deleted at its source is left out, and comes back if the asset does.

### Example

```ts
import {
  Configuration,
  ExploreApi,
} from '@workspace/api-client';
import type { ExploreControllerListViewsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new ExploreApi();

  try {
    const data = await api.exploreControllerListViews();
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

[**Array&lt;ExploreViewDto&gt;**](ExploreViewDto.md)

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


## exploreControllerNeighbourhood

> ExploreNeighbourhoodResponseDto exploreControllerNeighbourhood(exploreNeighbourhoodRequestDto)

What these assets are connected to, and why

Starts from up to ten assets and returns their neighbourhood by kind of connection: lineage and links (traced as far as asked, upstream, downstream or both), duplicates, shared values, shared glossary terms (drawn as the term itself), and likeness by meaning. Every link carries its reason; every asset says which cases hold it and which watches it answers. Each kind is read with its own bound, and assets deleted at their source are left out.

### Example

```ts
import {
  Configuration,
  ExploreApi,
} from '@workspace/api-client';
import type { ExploreControllerNeighbourhoodRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new ExploreApi();

  const body = {
    // ExploreNeighbourhoodRequestDto
    exploreNeighbourhoodRequestDto: ...,
  } satisfies ExploreControllerNeighbourhoodRequest;

  try {
    const data = await api.exploreControllerNeighbourhood(body);
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
| **exploreNeighbourhoodRequestDto** | [ExploreNeighbourhoodRequestDto](ExploreNeighbourhoodRequestDto.md) |  | |

### Return type

[**ExploreNeighbourhoodResponseDto**](ExploreNeighbourhoodResponseDto.md)

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


## exploreControllerStarters

> ExploreStartersResponseDto exploreControllerStarters()

Where to start exploring

The assets with the most lineage, the duplicate patterns with the most pairs (each with its strongest pair), and the links people drew last.

### Example

```ts
import {
  Configuration,
  ExploreApi,
} from '@workspace/api-client';
import type { ExploreControllerStartersRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new ExploreApi();

  try {
    const data = await api.exploreControllerStarters();
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

[**ExploreStartersResponseDto**](ExploreStartersResponseDto.md)

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


## exploreControllerUpdateView

> ExploreViewDto exploreControllerUpdateView(id, saveExploreViewDto)

Change a saved Explore view; what is left out stays

### Example

```ts
import {
  Configuration,
  ExploreApi,
} from '@workspace/api-client';
import type { ExploreControllerUpdateViewRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new ExploreApi();

  const body = {
    // string
    id: id_example,
    // SaveExploreViewDto
    saveExploreViewDto: ...,
  } satisfies ExploreControllerUpdateViewRequest;

  try {
    const data = await api.exploreControllerUpdateView(body);
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
| **saveExploreViewDto** | [SaveExploreViewDto](SaveExploreViewDto.md) |  | |

### Return type

[**ExploreViewDto**](ExploreViewDto.md)

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

