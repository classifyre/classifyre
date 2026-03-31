# AssetsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**assetsControllerGetAsset**](AssetsApi.md#assetscontrollergetasset) | **GET** /assets/{id} | Get asset by ID |
| [**searchAssetsControllerSearchAssets**](AssetsApi.md#searchassetscontrollersearchassets) | **POST** /search/assets | Search assets with findings |
| [**searchAssetsControllerSearchAssetsCharts**](AssetsApi.md#searchassetscontrollersearchassetscharts) | **POST** /search/assets/charts | Search assets charts overview |
| [**searchAssetsControllerSearchFindings**](AssetsApi.md#searchassetscontrollersearchfindings) | **POST** /search/findings | Search findings |
| [**searchAssetsControllerSearchFindingsCharts**](AssetsApi.md#searchassetscontrollersearchfindingscharts) | **POST** /search/findings/charts | Findings charts overview |
| [**searchAssetsControllerSearchFindingsCustomDetectors**](AssetsApi.md#searchassetscontrollersearchfindingscustomdetectors) | **POST** /search/findings/custom-detectors | List custom detector filter options |
| [**sourceAssetsControllerBulkIngest**](AssetsApi.md#sourceassetscontrollerbulkingest) | **POST** /sources/{sourceId}/assets/bulk | Bulk ingest assets |
| [**sourceAssetsControllerFinalizeIngest**](AssetsApi.md#sourceassetscontrollerfinalizeingest) | **POST** /sources/{sourceId}/assets/finalize | Finalize ingest run |
| [**sourceAssetsControllerListSourceAssets**](AssetsApi.md#sourceassetscontrollerlistsourceassets) | **GET** /sources/{sourceId}/assets | List assets for a source |



## assetsControllerGetAsset

> AssetListItemDto assetsControllerGetAsset(id)

Get asset by ID

Retrieve detailed information about a specific asset

### Example

```ts
import {
  Configuration,
  AssetsApi,
} from '@workspace/api-client';
import type { AssetsControllerGetAssetRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AssetsApi();

  const body = {
    // string | Asset unique identifier (deterministic UUID)
    id: a1b2c3d4-e5f6-7890-abcd-ef1234567890,
  } satisfies AssetsControllerGetAssetRequest;

  try {
    const data = await api.assetsControllerGetAsset(body);
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
| **id** | `string` | Asset unique identifier (deterministic UUID) | [Defaults to `undefined`] |

### Return type

[**AssetListItemDto**](AssetListItemDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Asset details |  -  |
| **404** | Asset not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## searchAssetsControllerSearchAssets

> SearchAssetsResponseDto searchAssetsControllerSearchAssets(searchAssetsRequestDto)

Search assets with findings

Search paginated assets and their matching findings with nested body filters.

### Example

```ts
import {
  Configuration,
  AssetsApi,
} from '@workspace/api-client';
import type { SearchAssetsControllerSearchAssetsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AssetsApi();

  const body = {
    // SearchAssetsRequestDto
    searchAssetsRequestDto: ...,
  } satisfies SearchAssetsControllerSearchAssetsRequest;

  try {
    const data = await api.searchAssetsControllerSearchAssets(body);
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
| **searchAssetsRequestDto** | [SearchAssetsRequestDto](SearchAssetsRequestDto.md) |  | |

### Return type

[**SearchAssetsResponseDto**](SearchAssetsResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Search results containing assets with findings |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## searchAssetsControllerSearchAssetsCharts

> SearchAssetsChartsResponseDto searchAssetsControllerSearchAssetsCharts(searchAssetsChartsRequestDto)

Search assets charts overview

Returns dashboard totals and chart datasets for assets in a single response.

### Example

```ts
import {
  Configuration,
  AssetsApi,
} from '@workspace/api-client';
import type { SearchAssetsControllerSearchAssetsChartsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AssetsApi();

  const body = {
    // SearchAssetsChartsRequestDto
    searchAssetsChartsRequestDto: ...,
  } satisfies SearchAssetsControllerSearchAssetsChartsRequest;

  try {
    const data = await api.searchAssetsControllerSearchAssetsCharts(body);
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
| **searchAssetsChartsRequestDto** | [SearchAssetsChartsRequestDto](SearchAssetsChartsRequestDto.md) |  | |

### Return type

[**SearchAssetsChartsResponseDto**](SearchAssetsChartsResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Chart overview containing totals and top lists |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## searchAssetsControllerSearchFindings

> SearchFindingsResponseDto searchAssetsControllerSearchFindings(searchFindingsRequestDto)

Search findings

Search paginated findings with nested body filters and server-side text search.

### Example

```ts
import {
  Configuration,
  AssetsApi,
} from '@workspace/api-client';
import type { SearchAssetsControllerSearchFindingsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AssetsApi();

  const body = {
    // SearchFindingsRequestDto
    searchFindingsRequestDto: ...,
  } satisfies SearchAssetsControllerSearchFindingsRequest;

  try {
    const data = await api.searchAssetsControllerSearchFindings(body);
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
| **searchFindingsRequestDto** | [SearchFindingsRequestDto](SearchFindingsRequestDto.md) |  | |

### Return type

[**SearchFindingsResponseDto**](SearchFindingsResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Search results containing findings |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## searchAssetsControllerSearchFindingsCharts

> SearchFindingsChartsResponseDto searchAssetsControllerSearchFindingsCharts(searchFindingsChartsRequestDto)

Findings charts overview

Returns totals, severity timeline, and top assets for findings in a single response.

### Example

```ts
import {
  Configuration,
  AssetsApi,
} from '@workspace/api-client';
import type { SearchAssetsControllerSearchFindingsChartsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AssetsApi();

  const body = {
    // SearchFindingsChartsRequestDto
    searchFindingsChartsRequestDto: ...,
  } satisfies SearchAssetsControllerSearchFindingsChartsRequest;

  try {
    const data = await api.searchAssetsControllerSearchFindingsCharts(body);
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
| **searchFindingsChartsRequestDto** | [SearchFindingsChartsRequestDto](SearchFindingsChartsRequestDto.md) |  | |

### Return type

[**SearchFindingsChartsResponseDto**](SearchFindingsChartsResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Chart overview containing totals, timeline and top assets |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## searchAssetsControllerSearchFindingsCustomDetectors

> Array&lt;SearchFindingsCustomDetectorOptionDto&gt; searchAssetsControllerSearchFindingsCustomDetectors(searchFindingsRequestDto)

List custom detector filter options

Returns custom detector key/name options with counts for findings filters.

### Example

```ts
import {
  Configuration,
  AssetsApi,
} from '@workspace/api-client';
import type { SearchAssetsControllerSearchFindingsCustomDetectorsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AssetsApi();

  const body = {
    // SearchFindingsRequestDto
    searchFindingsRequestDto: ...,
  } satisfies SearchAssetsControllerSearchFindingsCustomDetectorsRequest;

  try {
    const data = await api.searchAssetsControllerSearchFindingsCustomDetectors(body);
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
| **searchFindingsRequestDto** | [SearchFindingsRequestDto](SearchFindingsRequestDto.md) |  | |

### Return type

[**Array&lt;SearchFindingsCustomDetectorOptionDto&gt;**](SearchFindingsCustomDetectorOptionDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Custom detector options |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## sourceAssetsControllerBulkIngest

> SourceAssetsControllerBulkIngest201Response sourceAssetsControllerBulkIngest(sourceId, bulkIngestAssetsDto)

Bulk ingest assets

Ingest multiple assets at once for a specific source and run. Assets are upserted based on deterministic IDs.

### Example

```ts
import {
  Configuration,
  AssetsApi,
} from '@workspace/api-client';
import type { SourceAssetsControllerBulkIngestRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AssetsApi();

  const body = {
    // string | Source unique identifier
    sourceId: a1b2c3d4-e5f6-7890-abcd-ef1234567890,
    // BulkIngestAssetsDto
    bulkIngestAssetsDto: {"runId":"run_2026-01-31T10:00:00.000Z","assets":[{"hash":"V09SRFBSRVNTXyNfaHR0cHM6Ly9ibG9nLmV4YW1wbGUuY29tXyNfcG9zdHNfMTIz","external_url":"https://blog.example.com/posts/team-onboarding","name":"Team Onboarding","checksum":"617f1f8f8df58d7b34f8de63f6549d0a35f0bcde8ba08ec66db7f1db886f7f00","links":[],"asset_type":"URL","created_at":"2026-01-30T15:30:00.000Z","updated_at":"2026-01-30T15:30:00.000Z"},{"hash":"V09SRFBSRVNTXyNfaHR0cHM6Ly9ibG9nLmV4YW1wbGUuY29tXyNfcG9zdHNfNDU2","external_url":"https://blog.example.com/posts/development-guidelines","name":"Development Guidelines","checksum":"8ad39df6eb7f8bc9f67523455e8fd7f09d841f05d8be376de2600f62fc34265f","links":[],"asset_type":"URL","created_at":"2026-01-31T09:15:00.000Z","updated_at":"2026-01-31T09:15:00.000Z"}]},
  } satisfies SourceAssetsControllerBulkIngestRequest;

  try {
    const data = await api.sourceAssetsControllerBulkIngest(body);
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
| **sourceId** | `string` | Source unique identifier | [Defaults to `undefined`] |
| **bulkIngestAssetsDto** | [BulkIngestAssetsDto](BulkIngestAssetsDto.md) |  | |

### Return type

[**SourceAssetsControllerBulkIngest201Response**](SourceAssetsControllerBulkIngest201Response.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** | Assets ingested successfully |  -  |
| **400** | Invalid request - validation failed |  -  |
| **404** | Source not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## sourceAssetsControllerFinalizeIngest

> sourceAssetsControllerFinalizeIngest(sourceId, finalizeIngestRunDto)

Finalize ingest run

Finalizes ingest run. For sources with sampling strategy ALL, marks assets absent from seenHashes as DELETED and auto-resolves their open findings. For RANDOM/LATEST strategies this is a no-op since absence does not imply deletion.

### Example

```ts
import {
  Configuration,
  AssetsApi,
} from '@workspace/api-client';
import type { SourceAssetsControllerFinalizeIngestRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AssetsApi();

  const body = {
    // string | Source unique identifier
    sourceId: a1b2c3d4-e5f6-7890-abcd-ef1234567890,
    // FinalizeIngestRunDto
    finalizeIngestRunDto: ...,
  } satisfies SourceAssetsControllerFinalizeIngestRequest;

  try {
    const data = await api.sourceAssetsControllerFinalizeIngest(body);
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
| **sourceId** | `string` | Source unique identifier | [Defaults to `undefined`] |
| **finalizeIngestRunDto** | [FinalizeIngestRunDto](FinalizeIngestRunDto.md) |  | |

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


## sourceAssetsControllerListSourceAssets

> AssetListResponseDto sourceAssetsControllerListSourceAssets(sourceId, search, runnerId, status, sourceTypes, skip, limit)

List assets for a source

Retrieve all assets belonging to a specific data source

### Example

```ts
import {
  Configuration,
  AssetsApi,
} from '@workspace/api-client';
import type { SourceAssetsControllerListSourceAssetsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AssetsApi();

  const body = {
    // string | Source unique identifier
    sourceId: a1b2c3d4-e5f6-7890-abcd-ef1234567890,
    // string | Search by asset name (optional)
    search: search_example,
    // string | Filter by runner ID (optional)
    runnerId: runnerId_example,
    // Array<'NEW' | 'UPDATED' | 'UNCHANGED' | 'DELETED'> | Filter by one or more asset statuses (optional)
    status: ...,
    // Array<'JIRA' | 'CONFLUENCE' | 'CROWD' | 'BITBUCKET' | 'SERVICEDESK' | 'XRAY' | 'GOOGLE_DRIVE' | 'GOOGLE_SHEETS' | 'GOOGLE_DOCS' | 'GOOGLE_SLIDES' | 'WORDPRESS' | 'SLACK' | 'SITEMAP' | 'S3_COMPATIBLE_STORAGE' | 'AZURE_BLOB_STORAGE' | 'GOOGLE_CLOUD_STORAGE' | 'POSTGRESQL' | 'MYSQL' | 'MSSQL' | 'ORACLE' | 'HIVE' | 'DATABRICKS' | 'SNOWFLAKE' | 'MONGODB' | 'POWERBI' | 'TABLEAU' | 'CUSTOM'> | Filter by one or more source types (optional)
    sourceTypes: ...,
    // number (optional)
    skip: 8.14,
    // number (optional)
    limit: 8.14,
  } satisfies SourceAssetsControllerListSourceAssetsRequest;

  try {
    const data = await api.sourceAssetsControllerListSourceAssets(body);
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
| **sourceId** | `string` | Source unique identifier | [Defaults to `undefined`] |
| **search** | `string` | Search by asset name | [Optional] [Defaults to `undefined`] |
| **runnerId** | `string` | Filter by runner ID | [Optional] [Defaults to `undefined`] |
| **status** | `NEW`, `UPDATED`, `UNCHANGED`, `DELETED` | Filter by one or more asset statuses | [Optional] [Enum: NEW, UPDATED, UNCHANGED, DELETED] |
| **sourceTypes** | `JIRA`, `CONFLUENCE`, `CROWD`, `BITBUCKET`, `SERVICEDESK`, `XRAY`, `GOOGLE_DRIVE`, `GOOGLE_SHEETS`, `GOOGLE_DOCS`, `GOOGLE_SLIDES`, `WORDPRESS`, `SLACK`, `SITEMAP`, `S3_COMPATIBLE_STORAGE`, `AZURE_BLOB_STORAGE`, `GOOGLE_CLOUD_STORAGE`, `POSTGRESQL`, `MYSQL`, `MSSQL`, `ORACLE`, `HIVE`, `DATABRICKS`, `SNOWFLAKE`, `MONGODB`, `POWERBI`, `TABLEAU`, `CUSTOM` | Filter by one or more source types | [Optional] [Enum: JIRA, CONFLUENCE, CROWD, BITBUCKET, SERVICEDESK, XRAY, GOOGLE_DRIVE, GOOGLE_SHEETS, GOOGLE_DOCS, GOOGLE_SLIDES, WORDPRESS, SLACK, SITEMAP, S3_COMPATIBLE_STORAGE, AZURE_BLOB_STORAGE, GOOGLE_CLOUD_STORAGE, POSTGRESQL, MYSQL, MSSQL, ORACLE, HIVE, DATABRICKS, SNOWFLAKE, MONGODB, POWERBI, TABLEAU, CUSTOM] |
| **skip** | `number` |  | [Optional] [Defaults to `0`] |
| **limit** | `number` |  | [Optional] [Defaults to `50`] |

### Return type

[**AssetListResponseDto**](AssetListResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | List of assets for the source |  -  |
| **404** | Source not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

