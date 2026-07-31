# DataTransferApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**dataTransferControllerCancel**](DataTransferApi.md#datatransfercontrollercancel) | **POST** /data-transfer/jobs/{id}/cancel | Ask a running transfer to stop |
| [**dataTransferControllerDownload**](DataTransferApi.md#datatransfercontrollerdownload) | **GET** /data-transfer/exports/{id}/download | Download a completed export archive |
| [**dataTransferControllerJob**](DataTransferApi.md#datatransfercontrollerjob) | **GET** /data-transfer/jobs/{id} | Poll one transfer job for progress |
| [**dataTransferControllerJobs**](DataTransferApi.md#datatransfercontrollerjobs) | **GET** /data-transfer/jobs | List recent export and import jobs |
| [**dataTransferControllerRemove**](DataTransferApi.md#datatransfercontrollerremove) | **DELETE** /data-transfer/jobs/{id} | Delete a finished job and its archive |
| [**dataTransferControllerScopes**](DataTransferApi.md#datatransfercontrollerscopes) | **GET** /data-transfer/scopes | List the kinds of data that can be exported, with row counts |
| [**dataTransferControllerStartExport**](DataTransferApi.md#datatransfercontrollerstartexport) | **POST** /data-transfer/exports | Start an export of the selected scopes |
| [**dataTransferControllerStartImport**](DataTransferApi.md#datatransfercontrollerstartimport) | **POST** /data-transfer/imports | Import selected scopes from an uploaded archive |
| [**dataTransferControllerUpload**](DataTransferApi.md#datatransfercontrollerupload) | **POST** /data-transfer/imports/upload | Upload an archive and read its manifest without importing it |



## dataTransferControllerCancel

> DataTransferJobDto dataTransferControllerCancel(id)

Ask a running transfer to stop

### Example

```ts
import {
  Configuration,
  DataTransferApi,
} from '@workspace/api-client';
import type { DataTransferControllerCancelRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataTransferApi();

  const body = {
    // string
    id: id_example,
  } satisfies DataTransferControllerCancelRequest;

  try {
    const data = await api.dataTransferControllerCancel(body);
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

[**DataTransferJobDto**](DataTransferJobDto.md)

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


## dataTransferControllerDownload

> dataTransferControllerDownload(id)

Download a completed export archive

### Example

```ts
import {
  Configuration,
  DataTransferApi,
} from '@workspace/api-client';
import type { DataTransferControllerDownloadRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataTransferApi();

  const body = {
    // string
    id: id_example,
  } satisfies DataTransferControllerDownloadRequest;

  try {
    const data = await api.dataTransferControllerDownload(body);
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


## dataTransferControllerJob

> DataTransferJobDto dataTransferControllerJob(id)

Poll one transfer job for progress

### Example

```ts
import {
  Configuration,
  DataTransferApi,
} from '@workspace/api-client';
import type { DataTransferControllerJobRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataTransferApi();

  const body = {
    // string
    id: id_example,
  } satisfies DataTransferControllerJobRequest;

  try {
    const data = await api.dataTransferControllerJob(body);
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

[**DataTransferJobDto**](DataTransferJobDto.md)

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


## dataTransferControllerJobs

> DataTransferJobListDto dataTransferControllerJobs(limit)

List recent export and import jobs

### Example

```ts
import {
  Configuration,
  DataTransferApi,
} from '@workspace/api-client';
import type { DataTransferControllerJobsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataTransferApi();

  const body = {
    // string
    limit: limit_example,
  } satisfies DataTransferControllerJobsRequest;

  try {
    const data = await api.dataTransferControllerJobs(body);
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

[**DataTransferJobListDto**](DataTransferJobListDto.md)

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


## dataTransferControllerRemove

> DeleteDataTransferJobResponseDto dataTransferControllerRemove(id)

Delete a finished job and its archive

### Example

```ts
import {
  Configuration,
  DataTransferApi,
} from '@workspace/api-client';
import type { DataTransferControllerRemoveRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataTransferApi();

  const body = {
    // string
    id: id_example,
  } satisfies DataTransferControllerRemoveRequest;

  try {
    const data = await api.dataTransferControllerRemove(body);
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

[**DeleteDataTransferJobResponseDto**](DeleteDataTransferJobResponseDto.md)

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


## dataTransferControllerScopes

> Array&lt;TransferScopeDto&gt; dataTransferControllerScopes()

List the kinds of data that can be exported, with row counts

### Example

```ts
import {
  Configuration,
  DataTransferApi,
} from '@workspace/api-client';
import type { DataTransferControllerScopesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataTransferApi();

  try {
    const data = await api.dataTransferControllerScopes();
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

[**Array&lt;TransferScopeDto&gt;**](TransferScopeDto.md)

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


## dataTransferControllerStartExport

> DataTransferJobDto dataTransferControllerStartExport(startExportDto)

Start an export of the selected scopes

### Example

```ts
import {
  Configuration,
  DataTransferApi,
} from '@workspace/api-client';
import type { DataTransferControllerStartExportRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataTransferApi();

  const body = {
    // StartExportDto
    startExportDto: ...,
  } satisfies DataTransferControllerStartExportRequest;

  try {
    const data = await api.dataTransferControllerStartExport(body);
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
| **startExportDto** | [StartExportDto](StartExportDto.md) |  | |

### Return type

[**DataTransferJobDto**](DataTransferJobDto.md)

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


## dataTransferControllerStartImport

> DataTransferJobDto dataTransferControllerStartImport(startImportDto)

Import selected scopes from an uploaded archive

### Example

```ts
import {
  Configuration,
  DataTransferApi,
} from '@workspace/api-client';
import type { DataTransferControllerStartImportRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataTransferApi();

  const body = {
    // StartImportDto
    startImportDto: ...,
  } satisfies DataTransferControllerStartImportRequest;

  try {
    const data = await api.dataTransferControllerStartImport(body);
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
| **startImportDto** | [StartImportDto](StartImportDto.md) |  | |

### Return type

[**DataTransferJobDto**](DataTransferJobDto.md)

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


## dataTransferControllerUpload

> ArchivePreviewDto dataTransferControllerUpload(file)

Upload an archive and read its manifest without importing it

### Example

```ts
import {
  Configuration,
  DataTransferApi,
} from '@workspace/api-client';
import type { DataTransferControllerUploadRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataTransferApi();

  const body = {
    // Blob
    file: BINARY_DATA_HERE,
  } satisfies DataTransferControllerUploadRequest;

  try {
    const data = await api.dataTransferControllerUpload(body);
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
| **file** | `Blob` |  | [Defaults to `undefined`] |

### Return type

[**ArchivePreviewDto**](ArchivePreviewDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `multipart/form-data`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

