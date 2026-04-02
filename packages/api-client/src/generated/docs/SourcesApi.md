# SourcesApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**searchSourcesControllerSearchSources**](SourcesApi.md#searchsourcescontrollersearchsources) | **POST** /search/sources | Search data sources |
| [**sourceAssetsControllerBulkIngest**](SourcesApi.md#sourceassetscontrollerbulkingest) | **POST** /sources/{sourceId}/assets/bulk | Bulk ingest assets |
| [**sourceAssetsControllerFinalizeIngest**](SourcesApi.md#sourceassetscontrollerfinalizeingest) | **POST** /sources/{sourceId}/assets/finalize | Finalize ingest run |
| [**sourceAssetsControllerListSourceAssets**](SourcesApi.md#sourceassetscontrollerlistsourceassets) | **GET** /sources/{sourceId}/assets | List assets for a source |
| [**sourcesControllerCreateSource**](SourcesApi.md#sourcescontrollercreatesource) | **POST** /sources | Create a new data source |
| [**sourcesControllerDeleteSource**](SourcesApi.md#sourcescontrollerdeletesource) | **DELETE** /sources/{id} | Delete a data source |
| [**sourcesControllerGetSchedule**](SourcesApi.md#sourcescontrollergetschedule) | **GET** /sources/{id}/schedule | Get source schedule |
| [**sourcesControllerGetSource**](SourcesApi.md#sourcescontrollergetsource) | **GET** /sources/{id} | Get source by ID |
| [**sourcesControllerListSources**](SourcesApi.md#sourcescontrollerlistsources) | **GET** /sources | List all data sources |
| [**sourcesControllerStartRun**](SourcesApi.md#sourcescontrollerstartrun) | **POST** /sources/{id}/runs | Start a new ingestion run |
| [**sourcesControllerTestConnection**](SourcesApi.md#sourcescontrollertestconnection) | **POST** /sources/{id}/test | Test source connection |
| [**sourcesControllerUpdateSource**](SourcesApi.md#sourcescontrollerupdatesource) | **PUT** /sources/{id} | Update a data source |
| [**sourcesControllerUpdateStatus**](SourcesApi.md#sourcescontrollerupdatestatusoperation) | **PATCH** /sources/{id}/status | Update runner status |



## searchSourcesControllerSearchSources

> SearchSourcesResponseDto searchSourcesControllerSearchSources(searchSourcesRequestDto)

Search data sources

Paginated search over data sources with optional filters. Returns source details with the latest runner summary and aggregate totals (total, healthy, errors, running).

### Example

```ts
import {
  Configuration,
  SourcesApi,
} from '@workspace/api-client';
import type { SearchSourcesControllerSearchSourcesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SourcesApi();

  const body = {
    // SearchSourcesRequestDto
    searchSourcesRequestDto: ...,
  } satisfies SearchSourcesControllerSearchSourcesRequest;

  try {
    const data = await api.searchSourcesControllerSearchSources(body);
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
| **searchSourcesRequestDto** | [SearchSourcesRequestDto](SearchSourcesRequestDto.md) |  | |

### Return type

[**SearchSourcesResponseDto**](SearchSourcesResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Paginated list of sources with totals |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## sourceAssetsControllerBulkIngest

> SourceAssetsControllerBulkIngest201Response sourceAssetsControllerBulkIngest(sourceId, bulkIngestAssetsDto)

Bulk ingest assets

Ingest multiple assets at once for a specific source and run. Assets are upserted based on deterministic IDs.

### Example

```ts
import {
  Configuration,
  SourcesApi,
} from '@workspace/api-client';
import type { SourceAssetsControllerBulkIngestRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SourcesApi();

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
  SourcesApi,
} from '@workspace/api-client';
import type { SourceAssetsControllerFinalizeIngestRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SourcesApi();

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
  SourcesApi,
} from '@workspace/api-client';
import type { SourceAssetsControllerListSourceAssetsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SourcesApi();

  const body = {
    // string | Source unique identifier
    sourceId: a1b2c3d4-e5f6-7890-abcd-ef1234567890,
    // string | Search by asset name (optional)
    search: search_example,
    // string | Filter by runner ID (optional)
    runnerId: runnerId_example,
    // Array<'NEW' | 'UPDATED' | 'UNCHANGED' | 'DELETED'> | Filter by one or more asset statuses (optional)
    status: ...,
    // Array<'JIRA' | 'CONFLUENCE' | 'CROWD' | 'BITBUCKET' | 'SERVICEDESK' | 'XRAY' | 'GOOGLE_DRIVE' | 'GOOGLE_SHEETS' | 'GOOGLE_DOCS' | 'GOOGLE_SLIDES' | 'WORDPRESS' | 'SLACK' | 'S3_COMPATIBLE_STORAGE' | 'AZURE_BLOB_STORAGE' | 'GOOGLE_CLOUD_STORAGE' | 'POSTGRESQL' | 'MYSQL' | 'MSSQL' | 'ORACLE' | 'HIVE' | 'DATABRICKS' | 'SNOWFLAKE' | 'MONGODB' | 'POWERBI' | 'TABLEAU' | 'CUSTOM'> | Filter by one or more source types (optional)
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
| **sourceTypes** | `JIRA`, `CONFLUENCE`, `CROWD`, `BITBUCKET`, `SERVICEDESK`, `XRAY`, `GOOGLE_DRIVE`, `GOOGLE_SHEETS`, `GOOGLE_DOCS`, `GOOGLE_SLIDES`, `WORDPRESS`, `SLACK`, `S3_COMPATIBLE_STORAGE`, `AZURE_BLOB_STORAGE`, `GOOGLE_CLOUD_STORAGE`, `POSTGRESQL`, `MYSQL`, `MSSQL`, `ORACLE`, `HIVE`, `DATABRICKS`, `SNOWFLAKE`, `MONGODB`, `POWERBI`, `TABLEAU`, `CUSTOM` | Filter by one or more source types | [Optional] [Enum: JIRA, CONFLUENCE, CROWD, BITBUCKET, SERVICEDESK, XRAY, GOOGLE_DRIVE, GOOGLE_SHEETS, GOOGLE_DOCS, GOOGLE_SLIDES, WORDPRESS, SLACK, S3_COMPATIBLE_STORAGE, AZURE_BLOB_STORAGE, GOOGLE_CLOUD_STORAGE, POSTGRESQL, MYSQL, MSSQL, ORACLE, HIVE, DATABRICKS, SNOWFLAKE, MONGODB, POWERBI, TABLEAU, CUSTOM] |
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


## sourcesControllerCreateSource

> SourceResponseDto sourcesControllerCreateSource(createSourceDto)

Create a new data source

Register a new data source for metadata ingestion (WordPress, Slack, S3-Compatible Storage, Azure Blob Storage, Google Cloud Storage, PostgreSQL, MySQL, MSSQL, Oracle, Hive, Databricks, Snowflake, MongoDB, PowerBI, Tableau, Confluence, Jira, Service Desk).

### Example

```ts
import {
  Configuration,
  SourcesApi,
} from '@workspace/api-client';
import type { SourcesControllerCreateSourceRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SourcesApi();

  const body = {
    // CreateSourceDto
    createSourceDto: {"type":"WORDPRESS","name":"Production WordPress","config":{"type":"WORDPRESS","required":{"url":"https://blog.example.com"},"masked":{"username":"admin","application_password":"your-application-password"},"optional":{"content":{"fetch_posts":true,"fetch_pages":true}},"sampling":{"strategy":"RANDOM","limit":25}}},
  } satisfies SourcesControllerCreateSourceRequest;

  try {
    const data = await api.sourcesControllerCreateSource(body);
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
| **createSourceDto** | [CreateSourceDto](CreateSourceDto.md) |  | |

### Return type

[**SourceResponseDto**](SourceResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** | Source successfully created |  -  |
| **400** | Invalid request - validation failed |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## sourcesControllerDeleteSource

> sourcesControllerDeleteSource(id)

Delete a data source

Permanently delete a data source and all its associated data

### Example

```ts
import {
  Configuration,
  SourcesApi,
} from '@workspace/api-client';
import type { SourcesControllerDeleteSourceRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SourcesApi();

  const body = {
    // string | Source unique identifier
    id: a1b2c3d4-e5f6-7890-abcd-ef1234567890,
  } satisfies SourcesControllerDeleteSourceRequest;

  try {
    const data = await api.sourcesControllerDeleteSource(body);
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
| **id** | `string` | Source unique identifier | [Defaults to `undefined`] |

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
| **204** | Source successfully deleted |  -  |
| **404** | Source not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## sourcesControllerGetSchedule

> SourcesControllerGetSchedule200Response sourcesControllerGetSchedule(id)

Get source schedule

Retrieve the current cron schedule settings for a data source.

### Example

```ts
import {
  Configuration,
  SourcesApi,
} from '@workspace/api-client';
import type { SourcesControllerGetScheduleRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SourcesApi();

  const body = {
    // string | Source unique identifier
    id: a1b2c3d4-e5f6-7890-abcd-ef1234567890,
  } satisfies SourcesControllerGetScheduleRequest;

  try {
    const data = await api.sourcesControllerGetSchedule(body);
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
| **id** | `string` | Source unique identifier | [Defaults to `undefined`] |

### Return type

[**SourcesControllerGetSchedule200Response**](SourcesControllerGetSchedule200Response.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Schedule details |  -  |
| **404** | Source not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## sourcesControllerGetSource

> SourceResponseDto sourcesControllerGetSource(id)

Get source by ID

Retrieve detailed information about a specific data source

### Example

```ts
import {
  Configuration,
  SourcesApi,
} from '@workspace/api-client';
import type { SourcesControllerGetSourceRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SourcesApi();

  const body = {
    // string | Source unique identifier
    id: a1b2c3d4-e5f6-7890-abcd-ef1234567890,
  } satisfies SourcesControllerGetSourceRequest;

  try {
    const data = await api.sourcesControllerGetSource(body);
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
| **id** | `string` | Source unique identifier | [Defaults to `undefined`] |

### Return type

[**SourceResponseDto**](SourceResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Source details |  -  |
| **404** | Source not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## sourcesControllerListSources

> Array&lt;SourceResponseDto&gt; sourcesControllerListSources()

List all data sources

Retrieve a list of all registered data sources

### Example

```ts
import {
  Configuration,
  SourcesApi,
} from '@workspace/api-client';
import type { SourcesControllerListSourcesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SourcesApi();

  try {
    const data = await api.sourcesControllerListSources();
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

[**Array&lt;SourceResponseDto&gt;**](SourceResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | List of sources |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## sourcesControllerStartRun

> SourceResponseDto sourcesControllerStartRun(id)

Start a new ingestion run

Initiate a new data ingestion run for the specified source. This creates a new run ID and sets the runner status to PENDING.

### Example

```ts
import {
  Configuration,
  SourcesApi,
} from '@workspace/api-client';
import type { SourcesControllerStartRunRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SourcesApi();

  const body = {
    // string | Source unique identifier
    id: a1b2c3d4-e5f6-7890-abcd-ef1234567890,
  } satisfies SourcesControllerStartRunRequest;

  try {
    const data = await api.sourcesControllerStartRun(body);
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
| **id** | `string` | Source unique identifier | [Defaults to `undefined`] |

### Return type

[**SourceResponseDto**](SourceResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Run started successfully |  -  |
| **404** | Source not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## sourcesControllerTestConnection

> TestConnectionResponseDto sourcesControllerTestConnection(id)

Test source connection

Runs a lightweight CLI connection test for the specified source.

### Example

```ts
import {
  Configuration,
  SourcesApi,
} from '@workspace/api-client';
import type { SourcesControllerTestConnectionRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SourcesApi();

  const body = {
    // string | Source unique identifier
    id: a1b2c3d4-e5f6-7890-abcd-ef1234567890,
  } satisfies SourcesControllerTestConnectionRequest;

  try {
    const data = await api.sourcesControllerTestConnection(body);
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
| **id** | `string` | Source unique identifier | [Defaults to `undefined`] |

### Return type

[**TestConnectionResponseDto**](TestConnectionResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Connection test completed |  -  |
| **404** | Source not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## sourcesControllerUpdateSource

> SourceResponseDto sourcesControllerUpdateSource(id, updateSourceDto)

Update a data source

Update the configuration and/or name of an existing data source

### Example

```ts
import {
  Configuration,
  SourcesApi,
} from '@workspace/api-client';
import type { SourcesControllerUpdateSourceRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SourcesApi();

  const body = {
    // string | Source unique identifier
    id: a1b2c3d4-e5f6-7890-abcd-ef1234567890,
    // UpdateSourceDto
    updateSourceDto: {"config":{"type":"WORDPRESS","required":{"url":"https://updated-blog.example.com"},"masked":{"username":"admin","application_password":"updated-application-password"},"optional":{"content":{"fetch_posts":true,"fetch_pages":false}},"sampling":{"strategy":"RANDOM","limit":25}}},
  } satisfies SourcesControllerUpdateSourceRequest;

  try {
    const data = await api.sourcesControllerUpdateSource(body);
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
| **id** | `string` | Source unique identifier | [Defaults to `undefined`] |
| **updateSourceDto** | [UpdateSourceDto](UpdateSourceDto.md) |  | |

### Return type

[**SourceResponseDto**](SourceResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Source successfully updated |  -  |
| **400** | Invalid request - validation failed |  -  |
| **404** | Source not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## sourcesControllerUpdateStatus

> SourceResponseDto sourcesControllerUpdateStatus(id, sourcesControllerUpdateStatusRequest)

Update runner status

Compatibility wrapper that updates the current runner for a source. Only terminal statuses are allowed.

### Example

```ts
import {
  Configuration,
  SourcesApi,
} from '@workspace/api-client';
import type { SourcesControllerUpdateStatusOperationRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SourcesApi();

  const body = {
    // string | Source unique identifier
    id: a1b2c3d4-e5f6-7890-abcd-ef1234567890,
    // SourcesControllerUpdateStatusRequest
    sourcesControllerUpdateStatusRequest: {"status":"RUNNING"},
  } satisfies SourcesControllerUpdateStatusOperationRequest;

  try {
    const data = await api.sourcesControllerUpdateStatus(body);
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
| **id** | `string` | Source unique identifier | [Defaults to `undefined`] |
| **sourcesControllerUpdateStatusRequest** | [SourcesControllerUpdateStatusRequest](SourcesControllerUpdateStatusRequest.md) |  | |

### Return type

[**SourceResponseDto**](SourceResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Status updated successfully |  -  |
| **400** | Invalid status value |  -  |
| **404** | Source not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

