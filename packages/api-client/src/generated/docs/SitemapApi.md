# SitemapApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**sitemapControllerGetEntries**](SitemapApi.md#sitemapcontrollergetentries) | **GET** /sitemap/entries | One chunk of detail-page ids + last-modified dates |
| [**sitemapControllerGetIndex**](SitemapApi.md#sitemapcontrollergetindex) | **GET** /sitemap | Sitemap index: per-entity chunk counts and last-modified dates |



## sitemapControllerGetEntries

> SitemapEntriesDto sitemapControllerGetEntries(type, chunk, chunkSize)

One chunk of detail-page ids + last-modified dates

### Example

```ts
import {
  Configuration,
  SitemapApi,
} from '@workspace/api-client';
import type { SitemapControllerGetEntriesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SitemapApi();

  const body = {
    // 'source' | 'asset' | 'finding' | 'case' | 'inquiry' | 'detector' | 'scan'
    type: type_example,
    // string | Zero-based chunk. (optional)
    chunk: chunk_example,
    // string (optional)
    chunkSize: chunkSize_example,
  } satisfies SitemapControllerGetEntriesRequest;

  try {
    const data = await api.sitemapControllerGetEntries(body);
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
| **type** | `source`, `asset`, `finding`, `case`, `inquiry`, `detector`, `scan` |  | [Defaults to `undefined`] [Enum: source, asset, finding, case, inquiry, detector, scan] |
| **chunk** | `string` | Zero-based chunk. | [Optional] [Defaults to `undefined`] |
| **chunkSize** | `string` |  | [Optional] [Defaults to `undefined`] |

### Return type

[**SitemapEntriesDto**](SitemapEntriesDto.md)

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


## sitemapControllerGetIndex

> SitemapIndexDto sitemapControllerGetIndex(chunkSize)

Sitemap index: per-entity chunk counts and last-modified dates

### Example

```ts
import {
  Configuration,
  SitemapApi,
} from '@workspace/api-client';
import type { SitemapControllerGetIndexRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SitemapApi();

  const body = {
    // string | URLs per child sitemap (100–50000, default 10000). (optional)
    chunkSize: chunkSize_example,
  } satisfies SitemapControllerGetIndexRequest;

  try {
    const data = await api.sitemapControllerGetIndex(body);
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
| **chunkSize** | `string` | URLs per child sitemap (100–50000, default 10000). | [Optional] [Defaults to `undefined`] |

### Return type

[**SitemapIndexDto**](SitemapIndexDto.md)

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

