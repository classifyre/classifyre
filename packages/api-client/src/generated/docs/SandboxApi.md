# SandboxApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**sandboxControllerCreateRun**](SandboxApi.md#sandboxcontrollercreaterun) | **POST** /sandbox/runs | Upload a file and run detectors on it |
| [**sandboxControllerDeleteRun**](SandboxApi.md#sandboxcontrollerdeleterun) | **DELETE** /sandbox/runs/{id} | Delete a sandbox run |
| [**sandboxControllerGetRun**](SandboxApi.md#sandboxcontrollergetrun) | **GET** /sandbox/runs/{id} | Get a sandbox run by ID |
| [**sandboxControllerListRuns**](SandboxApi.md#sandboxcontrollerlistruns) | **GET** /sandbox/runs | List sandbox runs (paginated) |



## sandboxControllerCreateRun

> SandboxRunDto sandboxControllerCreateRun(file, detectors)

Upload a file and run detectors on it

Upload any local file (PDF, DOCX, XLSX, TXT, CSV, HTML, JSON, …) and run one or more detectors against its extracted text.  **&#x60;detectors&#x60;** is a JSON string containing an array of detector config objects. Each object has the shape: &#x60;&#x60;&#x60;json { \&quot;type\&quot;: \&quot;&lt;TYPE&gt;\&quot;, \&quot;enabled\&quot;: true, \&quot;config\&quot;: { ... } } &#x60;&#x60;&#x60;  ### Detector types &amp; sample configs  | Type | What it finds | |------|---------------| | &#x60;SECRETS&#x60; | API keys, tokens, private keys | | &#x60;PII&#x60; | Emails, SSNs, credit cards, phone numbers | | &#x60;TOXIC&#x60; | Toxic / hateful text (Detoxify model) | | &#x60;NSFW&#x60; | Sexually explicit content | | &#x60;YARA&#x60; | Custom YARA rule matches | | &#x60;BROKEN_LINKS&#x60; | Unreachable URLs in text |  **Minimal — secrets only (all patterns):** &#x60;&#x60;&#x60;json [{\&quot;type\&quot;:\&quot;SECRETS\&quot;,\&quot;enabled\&quot;:true,\&quot;config\&quot;:{}}] &#x60;&#x60;&#x60;  **PII with specific patterns:** &#x60;&#x60;&#x60;json [{\&quot;type\&quot;:\&quot;PII\&quot;,\&quot;enabled\&quot;:true,\&quot;config\&quot;:{\&quot;enabled_patterns\&quot;:[\&quot;email\&quot;,\&quot;credit_card\&quot;,\&quot;ssn\&quot;,\&quot;phone_number\&quot;],\&quot;confidence_threshold\&quot;:0.8}}] &#x60;&#x60;&#x60;  **Secrets + PII combined:** &#x60;&#x60;&#x60;json [   {\&quot;type\&quot;:\&quot;SECRETS\&quot;,\&quot;enabled\&quot;:true,\&quot;config\&quot;:{\&quot;enabled_patterns\&quot;:[\&quot;aws\&quot;,\&quot;github\&quot;,\&quot;stripe\&quot;,\&quot;generic_api_key\&quot;]}},   {\&quot;type\&quot;:\&quot;PII\&quot;,\&quot;enabled\&quot;:true,\&quot;config\&quot;:{\&quot;enabled_patterns\&quot;:[\&quot;email\&quot;,\&quot;ssn\&quot;,\&quot;credit_card\&quot;],\&quot;confidence_threshold\&quot;:0.75}} ] &#x60;&#x60;&#x60;  **Toxic content (multilingual model):** &#x60;&#x60;&#x60;json [{\&quot;type\&quot;:\&quot;TOXIC\&quot;,\&quot;enabled\&quot;:true,\&quot;config\&quot;:{\&quot;enabled_patterns\&quot;:[\&quot;toxicity\&quot;,\&quot;severe_toxicity\&quot;,\&quot;insult\&quot;],\&quot;model_name\&quot;:\&quot;multilingual\&quot;}}] &#x60;&#x60;&#x60;  **Full scan — all detectors:** &#x60;&#x60;&#x60;json [   {\&quot;type\&quot;:\&quot;SECRETS\&quot;,\&quot;enabled\&quot;:true,\&quot;config\&quot;:{}},   {\&quot;type\&quot;:\&quot;PII\&quot;,\&quot;enabled\&quot;:true,\&quot;config\&quot;:{\&quot;confidence_threshold\&quot;:0.7}},   {\&quot;type\&quot;:\&quot;TOXIC\&quot;,\&quot;enabled\&quot;:true,\&quot;config\&quot;:{}},   {\&quot;type\&quot;:\&quot;BROKEN_LINKS\&quot;,\&quot;enabled\&quot;:true,\&quot;config\&quot;:{}} ] &#x60;&#x60;&#x60;

### Example

```ts
import {
  Configuration,
  SandboxApi,
} from '@workspace/api-client';
import type { SandboxControllerCreateRunRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SandboxApi();

  const body = {
    // Blob | File to scan
    file: BINARY_DATA_HERE,
    // string | JSON array of detector config objects
    detectors: detectors_example,
  } satisfies SandboxControllerCreateRunRequest;

  try {
    const data = await api.sandboxControllerCreateRun(body);
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
| **file** | `Blob` | File to scan | [Defaults to `undefined`] |
| **detectors** | `string` | JSON array of detector config objects | [Defaults to `undefined`] |

### Return type

[**SandboxRunDto**](SandboxRunDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `multipart/form-data`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## sandboxControllerDeleteRun

> sandboxControllerDeleteRun(id)

Delete a sandbox run

Deletes a sandbox run record. If the run is currently in progress the CLI process is killed first.

### Example

```ts
import {
  Configuration,
  SandboxApi,
} from '@workspace/api-client';
import type { SandboxControllerDeleteRunRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SandboxApi();

  const body = {
    // string
    id: id_example,
  } satisfies SandboxControllerDeleteRunRequest;

  try {
    const data = await api.sandboxControllerDeleteRun(body);
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
| **204** | Run deleted |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## sandboxControllerGetRun

> SandboxRunDto sandboxControllerGetRun(id)

Get a sandbox run by ID

### Example

```ts
import {
  Configuration,
  SandboxApi,
} from '@workspace/api-client';
import type { SandboxControllerGetRunRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SandboxApi();

  const body = {
    // string
    id: id_example,
  } satisfies SandboxControllerGetRunRequest;

  try {
    const data = await api.sandboxControllerGetRun(body);
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

[**SandboxRunDto**](SandboxRunDto.md)

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


## sandboxControllerListRuns

> SandboxRunListResponseDto sandboxControllerListRuns(search, status, contentType, detectorType, hasFindings, sortBy, sortOrder, skip, limit)

List sandbox runs (paginated)

### Example

```ts
import {
  Configuration,
  SandboxApi,
} from '@workspace/api-client';
import type { SandboxControllerListRunsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SandboxApi();

  const body = {
    // string | Search by file name or MIME type (optional)
    search: search_example,
    // Array<'PENDING' | 'RUNNING' | 'COMPLETED' | 'ERROR'> | Filter by one or more run statuses (optional)
    status: ...,
    // Array<'TXT' | 'TABLE' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'URL' | 'BINARY' | 'OTHER'> | Filter by one or more content types (optional)
    contentType: ...,
    // Array<'SECRETS' | 'PII' | 'TOXIC' | 'NSFW' | 'YARA' | 'BROKEN_LINKS' | 'PROMPT_INJECTION' | 'PHISHING_URL' | 'SPAM' | 'LANGUAGE' | 'CODE_SECURITY' | 'PLAGIARISM' | 'IMAGE_VIOLENCE' | 'OCR_PII' | 'DEID_SCORE' | 'HATE_SPEECH' | 'AI_GENERATED' | 'CONTENT_QUALITY' | 'BIAS' | 'DUPLICATE' | 'DOMAIN_CLASS' | 'CONTENT_TYPE' | 'SENSITIVITY_TIER' | 'JURISDICTION_TAG' | 'CUSTOM'> | Filter by detectors used in the run configuration or reported findings (optional)
    detectorType: ...,
    // boolean | Filter by whether findings exist (optional)
    hasFindings: true,
    // 'CREATED_AT' | 'FILE_NAME' | 'STATUS' | 'FILE_SIZE_BYTES' | 'DURATION_MS' | 'FINDINGS_COUNT' | Sort field (optional)
    sortBy: sortBy_example,
    // 'ASC' | 'DESC' | Sort direction (optional)
    sortOrder: sortOrder_example,
    // number (optional)
    skip: 8.14,
    // number (optional)
    limit: 8.14,
  } satisfies SandboxControllerListRunsRequest;

  try {
    const data = await api.sandboxControllerListRuns(body);
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
| **search** | `string` | Search by file name or MIME type | [Optional] [Defaults to `undefined`] |
| **status** | `PENDING`, `RUNNING`, `COMPLETED`, `ERROR` | Filter by one or more run statuses | [Optional] [Enum: PENDING, RUNNING, COMPLETED, ERROR] |
| **contentType** | `TXT`, `TABLE`, `IMAGE`, `VIDEO`, `AUDIO`, `URL`, `BINARY`, `OTHER` | Filter by one or more content types | [Optional] [Enum: TXT, TABLE, IMAGE, VIDEO, AUDIO, URL, BINARY, OTHER] |
| **detectorType** | `SECRETS`, `PII`, `TOXIC`, `NSFW`, `YARA`, `BROKEN_LINKS`, `PROMPT_INJECTION`, `PHISHING_URL`, `SPAM`, `LANGUAGE`, `CODE_SECURITY`, `PLAGIARISM`, `IMAGE_VIOLENCE`, `OCR_PII`, `DEID_SCORE`, `HATE_SPEECH`, `AI_GENERATED`, `CONTENT_QUALITY`, `BIAS`, `DUPLICATE`, `DOMAIN_CLASS`, `CONTENT_TYPE`, `SENSITIVITY_TIER`, `JURISDICTION_TAG`, `CUSTOM` | Filter by detectors used in the run configuration or reported findings | [Optional] [Enum: SECRETS, PII, TOXIC, NSFW, YARA, BROKEN_LINKS, PROMPT_INJECTION, PHISHING_URL, SPAM, LANGUAGE, CODE_SECURITY, PLAGIARISM, IMAGE_VIOLENCE, OCR_PII, DEID_SCORE, HATE_SPEECH, AI_GENERATED, CONTENT_QUALITY, BIAS, DUPLICATE, DOMAIN_CLASS, CONTENT_TYPE, SENSITIVITY_TIER, JURISDICTION_TAG, CUSTOM] |
| **hasFindings** | `boolean` | Filter by whether findings exist | [Optional] [Defaults to `undefined`] |
| **sortBy** | `CREATED_AT`, `FILE_NAME`, `STATUS`, `FILE_SIZE_BYTES`, `DURATION_MS`, `FINDINGS_COUNT` | Sort field | [Optional] [Defaults to `&#39;CREATED_AT&#39;`] [Enum: CREATED_AT, FILE_NAME, STATUS, FILE_SIZE_BYTES, DURATION_MS, FINDINGS_COUNT] |
| **sortOrder** | `ASC`, `DESC` | Sort direction | [Optional] [Defaults to `&#39;DESC&#39;`] [Enum: ASC, DESC] |
| **skip** | `number` |  | [Optional] [Defaults to `0`] |
| **limit** | `number` |  | [Optional] [Defaults to `50`] |

### Return type

[**SandboxRunListResponseDto**](SandboxRunListResponseDto.md)

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

