# CustomDetectorsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**customDetectorsControllerClearTrainingExamples**](CustomDetectorsApi.md#customdetectorscontrollercleartrainingexamples) | **DELETE** /custom-detectors/{id}/training-examples | Delete all training examples for a detector |
| [**customDetectorsControllerCreate**](CustomDetectorsApi.md#customdetectorscontrollercreate) | **POST** /custom-detectors | Create custom detector |
| [**customDetectorsControllerDelete**](CustomDetectorsApi.md#customdetectorscontrollerdelete) | **DELETE** /custom-detectors/{id} | Delete custom detector |
| [**customDetectorsControllerDeleteTrainingExample**](CustomDetectorsApi.md#customdetectorscontrollerdeletetrainingexample) | **DELETE** /custom-detectors/{id}/training-examples/{exampleId} | Delete a single training example |
| [**customDetectorsControllerGetById**](CustomDetectorsApi.md#customdetectorscontrollergetbyid) | **GET** /custom-detectors/{id} | Get custom detector by ID |
| [**customDetectorsControllerList**](CustomDetectorsApi.md#customdetectorscontrollerlist) | **GET** /custom-detectors | List custom detectors |
| [**customDetectorsControllerListExamples**](CustomDetectorsApi.md#customdetectorscontrollerlistexamples) | **GET** /custom-detectors/examples | List custom detector starter examples |
| [**customDetectorsControllerListTrainingExamples**](CustomDetectorsApi.md#customdetectorscontrollerlisttrainingexamples) | **GET** /custom-detectors/{id}/training-examples | List stored training examples for a detector |
| [**customDetectorsControllerParseTrainingExamples**](CustomDetectorsApi.md#customdetectorscontrollerparsetrainingexamples) | **POST** /custom-detectors/training-examples/parse | Parse uploaded training examples file |
| [**customDetectorsControllerSaveTrainingExamples**](CustomDetectorsApi.md#customdetectorscontrollersavetrainingexamples) | **POST** /custom-detectors/{id}/training-examples | Save training examples for a detector |
| [**customDetectorsControllerTrain**](CustomDetectorsApi.md#customdetectorscontrollertrain) | **POST** /custom-detectors/{id}/train | Trigger custom detector training |
| [**customDetectorsControllerTrainingExamplesStats**](CustomDetectorsApi.md#customdetectorscontrollertrainingexamplesstats) | **GET** /custom-detectors/{id}/training-examples/stats | Get training example counts grouped by label |
| [**customDetectorsControllerTrainingHistory**](CustomDetectorsApi.md#customdetectorscontrollertraininghistory) | **GET** /custom-detectors/{id}/training-history | List training history for custom detector |
| [**customDetectorsControllerUpdate**](CustomDetectorsApi.md#customdetectorscontrollerupdate) | **PATCH** /custom-detectors/{id} | Update custom detector |



## customDetectorsControllerClearTrainingExamples

> any customDetectorsControllerClearTrainingExamples(id)

Delete all training examples for a detector

### Example

```ts
import {
  Configuration,
  CustomDetectorsApi,
} from '@workspace/api-client';
import type { CustomDetectorsControllerClearTrainingExamplesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomDetectorsApi();

  const body = {
    // string | Custom detector UUID
    id: id_example,
  } satisfies CustomDetectorsControllerClearTrainingExamplesRequest;

  try {
    const data = await api.customDetectorsControllerClearTrainingExamples(body);
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
| **id** | `string` | Custom detector UUID | [Defaults to `undefined`] |

### Return type

**any**

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


## customDetectorsControllerCreate

> CustomDetectorResponseDto customDetectorsControllerCreate(createCustomDetectorDto)

Create custom detector

### Example

```ts
import {
  Configuration,
  CustomDetectorsApi,
} from '@workspace/api-client';
import type { CustomDetectorsControllerCreateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomDetectorsApi();

  const body = {
    // CreateCustomDetectorDto
    createCustomDetectorDto: ...,
  } satisfies CustomDetectorsControllerCreateRequest;

  try {
    const data = await api.customDetectorsControllerCreate(body);
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
| **createCustomDetectorDto** | [CreateCustomDetectorDto](CreateCustomDetectorDto.md) |  | |

### Return type

[**CustomDetectorResponseDto**](CustomDetectorResponseDto.md)

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


## customDetectorsControllerDelete

> any customDetectorsControllerDelete(id)

Delete custom detector

### Example

```ts
import {
  Configuration,
  CustomDetectorsApi,
} from '@workspace/api-client';
import type { CustomDetectorsControllerDeleteRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomDetectorsApi();

  const body = {
    // string | Custom detector UUID
    id: id_example,
  } satisfies CustomDetectorsControllerDeleteRequest;

  try {
    const data = await api.customDetectorsControllerDelete(body);
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
| **id** | `string` | Custom detector UUID | [Defaults to `undefined`] |

### Return type

**any**

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


## customDetectorsControllerDeleteTrainingExample

> any customDetectorsControllerDeleteTrainingExample(id, exampleId)

Delete a single training example

### Example

```ts
import {
  Configuration,
  CustomDetectorsApi,
} from '@workspace/api-client';
import type { CustomDetectorsControllerDeleteTrainingExampleRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomDetectorsApi();

  const body = {
    // string | Custom detector UUID
    id: id_example,
    // string | Training example UUID
    exampleId: exampleId_example,
  } satisfies CustomDetectorsControllerDeleteTrainingExampleRequest;

  try {
    const data = await api.customDetectorsControllerDeleteTrainingExample(body);
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
| **id** | `string` | Custom detector UUID | [Defaults to `undefined`] |
| **exampleId** | `string` | Training example UUID | [Defaults to `undefined`] |

### Return type

**any**

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


## customDetectorsControllerGetById

> CustomDetectorResponseDto customDetectorsControllerGetById(id)

Get custom detector by ID

### Example

```ts
import {
  Configuration,
  CustomDetectorsApi,
} from '@workspace/api-client';
import type { CustomDetectorsControllerGetByIdRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomDetectorsApi();

  const body = {
    // string | Custom detector UUID
    id: id_example,
  } satisfies CustomDetectorsControllerGetByIdRequest;

  try {
    const data = await api.customDetectorsControllerGetById(body);
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
| **id** | `string` | Custom detector UUID | [Defaults to `undefined`] |

### Return type

[**CustomDetectorResponseDto**](CustomDetectorResponseDto.md)

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


## customDetectorsControllerList

> Array&lt;CustomDetectorResponseDto&gt; customDetectorsControllerList(includeInactive)

List custom detectors

### Example

```ts
import {
  Configuration,
  CustomDetectorsApi,
} from '@workspace/api-client';
import type { CustomDetectorsControllerListRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomDetectorsApi();

  const body = {
    // boolean | Whether to include inactive detectors (optional)
    includeInactive: true,
  } satisfies CustomDetectorsControllerListRequest;

  try {
    const data = await api.customDetectorsControllerList(body);
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
| **includeInactive** | `boolean` | Whether to include inactive detectors | [Optional] [Defaults to `false`] |

### Return type

[**Array&lt;CustomDetectorResponseDto&gt;**](CustomDetectorResponseDto.md)

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


## customDetectorsControllerListExamples

> Array&lt;CustomDetectorExampleDto&gt; customDetectorsControllerListExamples()

List custom detector starter examples

### Example

```ts
import {
  Configuration,
  CustomDetectorsApi,
} from '@workspace/api-client';
import type { CustomDetectorsControllerListExamplesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomDetectorsApi();

  try {
    const data = await api.customDetectorsControllerListExamples();
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

[**Array&lt;CustomDetectorExampleDto&gt;**](CustomDetectorExampleDto.md)

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


## customDetectorsControllerListTrainingExamples

> Array&lt;TrainingExampleDto&gt; customDetectorsControllerListTrainingExamples(id)

List stored training examples for a detector

### Example

```ts
import {
  Configuration,
  CustomDetectorsApi,
} from '@workspace/api-client';
import type { CustomDetectorsControllerListTrainingExamplesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomDetectorsApi();

  const body = {
    // string | Custom detector UUID
    id: id_example,
  } satisfies CustomDetectorsControllerListTrainingExamplesRequest;

  try {
    const data = await api.customDetectorsControllerListTrainingExamples(body);
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
| **id** | `string` | Custom detector UUID | [Defaults to `undefined`] |

### Return type

[**Array&lt;TrainingExampleDto&gt;**](TrainingExampleDto.md)

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


## customDetectorsControllerParseTrainingExamples

> ParseTrainingExamplesResponseDto customDetectorsControllerParseTrainingExamples(file)

Parse uploaded training examples file

Accepts csv/tsv/txt/md/log/json/xlsx and returns normalized label/text training examples.

### Example

```ts
import {
  Configuration,
  CustomDetectorsApi,
} from '@workspace/api-client';
import type { CustomDetectorsControllerParseTrainingExamplesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomDetectorsApi();

  const body = {
    // Blob | Training data file to parse
    file: BINARY_DATA_HERE,
  } satisfies CustomDetectorsControllerParseTrainingExamplesRequest;

  try {
    const data = await api.customDetectorsControllerParseTrainingExamples(body);
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
| **file** | `Blob` | Training data file to parse | [Defaults to `undefined`] |

### Return type

[**ParseTrainingExamplesResponseDto**](ParseTrainingExamplesResponseDto.md)

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


## customDetectorsControllerSaveTrainingExamples

> any customDetectorsControllerSaveTrainingExamples(id, saveTrainingExamplesDto)

Save training examples for a detector

Appends (or replaces) labeled examples. Set clearExisting&#x3D;true to wipe previous examples first.

### Example

```ts
import {
  Configuration,
  CustomDetectorsApi,
} from '@workspace/api-client';
import type { CustomDetectorsControllerSaveTrainingExamplesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomDetectorsApi();

  const body = {
    // string | Custom detector UUID
    id: id_example,
    // SaveTrainingExamplesDto
    saveTrainingExamplesDto: ...,
  } satisfies CustomDetectorsControllerSaveTrainingExamplesRequest;

  try {
    const data = await api.customDetectorsControllerSaveTrainingExamples(body);
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
| **id** | `string` | Custom detector UUID | [Defaults to `undefined`] |
| **saveTrainingExamplesDto** | [SaveTrainingExamplesDto](SaveTrainingExamplesDto.md) |  | |

### Return type

**any**

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


## customDetectorsControllerTrain

> CustomDetectorTrainingRunDto customDetectorsControllerTrain(id, trainCustomDetectorDto)

Trigger custom detector training

### Example

```ts
import {
  Configuration,
  CustomDetectorsApi,
} from '@workspace/api-client';
import type { CustomDetectorsControllerTrainRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomDetectorsApi();

  const body = {
    // string | Custom detector UUID
    id: id_example,
    // TrainCustomDetectorDto (optional)
    trainCustomDetectorDto: ...,
  } satisfies CustomDetectorsControllerTrainRequest;

  try {
    const data = await api.customDetectorsControllerTrain(body);
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
| **id** | `string` | Custom detector UUID | [Defaults to `undefined`] |
| **trainCustomDetectorDto** | [TrainCustomDetectorDto](TrainCustomDetectorDto.md) |  | [Optional] |

### Return type

[**CustomDetectorTrainingRunDto**](CustomDetectorTrainingRunDto.md)

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


## customDetectorsControllerTrainingExamplesStats

> TrainingExamplesStatsDto customDetectorsControllerTrainingExamplesStats(id)

Get training example counts grouped by label

### Example

```ts
import {
  Configuration,
  CustomDetectorsApi,
} from '@workspace/api-client';
import type { CustomDetectorsControllerTrainingExamplesStatsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomDetectorsApi();

  const body = {
    // string | Custom detector UUID
    id: id_example,
  } satisfies CustomDetectorsControllerTrainingExamplesStatsRequest;

  try {
    const data = await api.customDetectorsControllerTrainingExamplesStats(body);
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
| **id** | `string` | Custom detector UUID | [Defaults to `undefined`] |

### Return type

[**TrainingExamplesStatsDto**](TrainingExamplesStatsDto.md)

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


## customDetectorsControllerTrainingHistory

> Array&lt;CustomDetectorTrainingRunDto&gt; customDetectorsControllerTrainingHistory(id, take)

List training history for custom detector

### Example

```ts
import {
  Configuration,
  CustomDetectorsApi,
} from '@workspace/api-client';
import type { CustomDetectorsControllerTrainingHistoryRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomDetectorsApi();

  const body = {
    // string | Custom detector UUID
    id: id_example,
    // string | Maximum history rows to return (optional)
    take: take_example,
  } satisfies CustomDetectorsControllerTrainingHistoryRequest;

  try {
    const data = await api.customDetectorsControllerTrainingHistory(body);
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
| **id** | `string` | Custom detector UUID | [Defaults to `undefined`] |
| **take** | `string` | Maximum history rows to return | [Optional] [Defaults to `undefined`] |

### Return type

[**Array&lt;CustomDetectorTrainingRunDto&gt;**](CustomDetectorTrainingRunDto.md)

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


## customDetectorsControllerUpdate

> CustomDetectorResponseDto customDetectorsControllerUpdate(id, updateCustomDetectorDto)

Update custom detector

### Example

```ts
import {
  Configuration,
  CustomDetectorsApi,
} from '@workspace/api-client';
import type { CustomDetectorsControllerUpdateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new CustomDetectorsApi();

  const body = {
    // string | Custom detector UUID
    id: id_example,
    // UpdateCustomDetectorDto
    updateCustomDetectorDto: ...,
  } satisfies CustomDetectorsControllerUpdateRequest;

  try {
    const data = await api.customDetectorsControllerUpdate(body);
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
| **id** | `string` | Custom detector UUID | [Defaults to `undefined`] |
| **updateCustomDetectorDto** | [UpdateCustomDetectorDto](UpdateCustomDetectorDto.md) |  | |

### Return type

[**CustomDetectorResponseDto**](CustomDetectorResponseDto.md)

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

