# DataRequestsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**dataRequestsControllerAddComment**](DataRequestsApi.md#datarequestscontrolleraddcomment) | **POST** /data-requests/{id}/comments | Pin a discussion comment onto the request canvas |
| [**dataRequestsControllerCheck**](DataRequestsApi.md#datarequestscontrollercheck) | **POST** /data-requests/{id}/check | Fast static check of the request SQL against the routed group catalog |
| [**dataRequestsControllerClaim**](DataRequestsApi.md#datarequestscontrollerclaim) | **POST** /data-requests/{id}/claim | Claim a data request for a team member |
| [**dataRequestsControllerCreate**](DataRequestsApi.md#datarequestscontrollercreate) | **POST** /data-requests | Create a new draft data request case |
| [**dataRequestsControllerDecline**](DataRequestsApi.md#datarequestscontrollerdecline) | **POST** /data-requests/{id}/decline | Decline a data request with a reason |
| [**dataRequestsControllerDeliver**](DataRequestsApi.md#datarequestscontrollerdeliver) | **POST** /data-requests/{id}/deliver | Deliver a shared dataset to fulfil the data request |
| [**dataRequestsControllerDescribe**](DataRequestsApi.md#datarequestscontrollerdescribe) | **POST** /data-requests/{id}/describe | Describe SQL lineage and floors as the routed group (cached by SQL hash) |
| [**dataRequestsControllerGet**](DataRequestsApi.md#datarequestscontrollerget) | **GET** /data-requests/{id} | Get a data request with spec, deliveries, and live dataset status |
| [**dataRequestsControllerGetCommentEntries**](DataRequestsApi.md#datarequestscontrollergetcommententries) | **GET** /data-requests/{id}/comments/{threadId}/entries | List entries on a data request comment pin |
| [**dataRequestsControllerList**](DataRequestsApi.md#datarequestscontrollerlist) | **GET** /data-requests | List data requests (mine, team, or all) |
| [**dataRequestsControllerOptions**](DataRequestsApi.md#datarequestscontrolleroptions) | **GET** /data-requests/options | List eligible route groups, caller audience groups, and self-serve hint |
| [**dataRequestsControllerReplyComment**](DataRequestsApi.md#datarequestscontrollerreplycomment) | **POST** /data-requests/{id}/comments/{threadId}/entries | Reply to a data request comment pin |
| [**dataRequestsControllerRequestChanges**](DataRequestsApi.md#datarequestscontrollerrequestchanges) | **POST** /data-requests/{id}/request-changes | Request changes on a delivered data request |
| [**dataRequestsControllerReroute**](DataRequestsApi.md#datarequestscontrollerreroute) | **POST** /data-requests/{id}/reroute | Reroute a data request to another data-team group |
| [**dataRequestsControllerResolveComment**](DataRequestsApi.md#datarequestscontrollerresolvecomment) | **PATCH** /data-requests/{id}/comments/{threadId}/resolve | Resolve or reopen a data request comment pin |
| [**dataRequestsControllerSubmit**](DataRequestsApi.md#datarequestscontrollersubmit) | **POST** /data-requests/{id}/submit | Submit a draft data request to the routed group |
| [**dataRequestsControllerUpdateSpec**](DataRequestsApi.md#datarequestscontrollerupdatespec) | **PUT** /data-requests/{id}/spec | Update the visual join canvas spec (optimistic concurrency) |
| [**dataRequestsControllerUpdateSql**](DataRequestsApi.md#datarequestscontrollerupdatesql) | **PUT** /data-requests/{id}/sql | Hand-edit or regenerate the request SQL (data team only) |
| [**dataRequestsControllerWithdraw**](DataRequestsApi.md#datarequestscontrollerwithdraw) | **POST** /data-requests/{id}/withdraw | Withdraw an open data request |



## dataRequestsControllerAddComment

> AddDataRequestCommentResponseDto dataRequestsControllerAddComment(id, addDataRequestCommentDto)

Pin a discussion comment onto the request canvas

### Example

```ts
import {
  Configuration,
  DataRequestsApi,
} from '@workspace/api-client';
import type { DataRequestsControllerAddCommentRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataRequestsApi();

  const body = {
    // string
    id: id_example,
    // AddDataRequestCommentDto
    addDataRequestCommentDto: ...,
  } satisfies DataRequestsControllerAddCommentRequest;

  try {
    const data = await api.dataRequestsControllerAddComment(body);
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
| **addDataRequestCommentDto** | [AddDataRequestCommentDto](AddDataRequestCommentDto.md) |  | |

### Return type

[**AddDataRequestCommentResponseDto**](AddDataRequestCommentResponseDto.md)

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


## dataRequestsControllerCheck

> DataRequestCheckResultDto dataRequestsControllerCheck(id)

Fast static check of the request SQL against the routed group catalog

### Example

```ts
import {
  Configuration,
  DataRequestsApi,
} from '@workspace/api-client';
import type { DataRequestsControllerCheckRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataRequestsApi();

  const body = {
    // string
    id: id_example,
  } satisfies DataRequestsControllerCheckRequest;

  try {
    const data = await api.dataRequestsControllerCheck(body);
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

[**DataRequestCheckResultDto**](DataRequestCheckResultDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## dataRequestsControllerClaim

> DataRequestDetailDto dataRequestsControllerClaim(id, claimDataRequestDto)

Claim a data request for a team member

### Example

```ts
import {
  Configuration,
  DataRequestsApi,
} from '@workspace/api-client';
import type { DataRequestsControllerClaimRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataRequestsApi();

  const body = {
    // string
    id: id_example,
    // ClaimDataRequestDto
    claimDataRequestDto: ...,
  } satisfies DataRequestsControllerClaimRequest;

  try {
    const data = await api.dataRequestsControllerClaim(body);
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
| **claimDataRequestDto** | [ClaimDataRequestDto](ClaimDataRequestDto.md) |  | |

### Return type

[**DataRequestDetailDto**](DataRequestDetailDto.md)

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


## dataRequestsControllerCreate

> DataRequestDetailDto dataRequestsControllerCreate(createDataRequestDto)

Create a new draft data request case

### Example

```ts
import {
  Configuration,
  DataRequestsApi,
} from '@workspace/api-client';
import type { DataRequestsControllerCreateRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataRequestsApi();

  const body = {
    // CreateDataRequestDto
    createDataRequestDto: ...,
  } satisfies DataRequestsControllerCreateRequest;

  try {
    const data = await api.dataRequestsControllerCreate(body);
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
| **createDataRequestDto** | [CreateDataRequestDto](CreateDataRequestDto.md) |  | |

### Return type

[**DataRequestDetailDto**](DataRequestDetailDto.md)

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


## dataRequestsControllerDecline

> DataRequestDetailDto dataRequestsControllerDecline(id, declineDataRequestDto)

Decline a data request with a reason

### Example

```ts
import {
  Configuration,
  DataRequestsApi,
} from '@workspace/api-client';
import type { DataRequestsControllerDeclineRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataRequestsApi();

  const body = {
    // string
    id: id_example,
    // DeclineDataRequestDto
    declineDataRequestDto: ...,
  } satisfies DataRequestsControllerDeclineRequest;

  try {
    const data = await api.dataRequestsControllerDecline(body);
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
| **declineDataRequestDto** | [DeclineDataRequestDto](DeclineDataRequestDto.md) |  | |

### Return type

[**DataRequestDetailDto**](DataRequestDetailDto.md)

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


## dataRequestsControllerDeliver

> DataRequestDetailDto dataRequestsControllerDeliver(id, deliverDataRequestDto)

Deliver a shared dataset to fulfil the data request

### Example

```ts
import {
  Configuration,
  DataRequestsApi,
} from '@workspace/api-client';
import type { DataRequestsControllerDeliverRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataRequestsApi();

  const body = {
    // string
    id: id_example,
    // DeliverDataRequestDto
    deliverDataRequestDto: ...,
  } satisfies DataRequestsControllerDeliverRequest;

  try {
    const data = await api.dataRequestsControllerDeliver(body);
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
| **deliverDataRequestDto** | [DeliverDataRequestDto](DeliverDataRequestDto.md) |  | |

### Return type

[**DataRequestDetailDto**](DataRequestDetailDto.md)

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


## dataRequestsControllerDescribe

> DataRequestDescribeResultDto dataRequestsControllerDescribe(id)

Describe SQL lineage and floors as the routed group (cached by SQL hash)

### Example

```ts
import {
  Configuration,
  DataRequestsApi,
} from '@workspace/api-client';
import type { DataRequestsControllerDescribeRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataRequestsApi();

  const body = {
    // string
    id: id_example,
  } satisfies DataRequestsControllerDescribeRequest;

  try {
    const data = await api.dataRequestsControllerDescribe(body);
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

[**DataRequestDescribeResultDto**](DataRequestDescribeResultDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## dataRequestsControllerGet

> DataRequestDetailDto dataRequestsControllerGet(id)

Get a data request with spec, deliveries, and live dataset status

### Example

```ts
import {
  Configuration,
  DataRequestsApi,
} from '@workspace/api-client';
import type { DataRequestsControllerGetRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataRequestsApi();

  const body = {
    // string
    id: id_example,
  } satisfies DataRequestsControllerGetRequest;

  try {
    const data = await api.dataRequestsControllerGet(body);
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

[**DataRequestDetailDto**](DataRequestDetailDto.md)

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


## dataRequestsControllerGetCommentEntries

> ThreadEntriesResponseDto dataRequestsControllerGetCommentEntries(id, threadId)

List entries on a data request comment pin

### Example

```ts
import {
  Configuration,
  DataRequestsApi,
} from '@workspace/api-client';
import type { DataRequestsControllerGetCommentEntriesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataRequestsApi();

  const body = {
    // string
    id: id_example,
    // string
    threadId: threadId_example,
  } satisfies DataRequestsControllerGetCommentEntriesRequest;

  try {
    const data = await api.dataRequestsControllerGetCommentEntries(body);
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
| **threadId** | `string` |  | [Defaults to `undefined`] |

### Return type

[**ThreadEntriesResponseDto**](ThreadEntriesResponseDto.md)

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


## dataRequestsControllerList

> DataRequestListResponseDto dataRequestsControllerList(scope)

List data requests (mine, team, or all)

### Example

```ts
import {
  Configuration,
  DataRequestsApi,
} from '@workspace/api-client';
import type { DataRequestsControllerListRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataRequestsApi();

  const body = {
    // 'mine' | 'team' | 'all' (optional)
    scope: scope_example,
  } satisfies DataRequestsControllerListRequest;

  try {
    const data = await api.dataRequestsControllerList(body);
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
| **scope** | `mine`, `team`, `all` |  | [Optional] [Defaults to `undefined`] [Enum: mine, team, all] |

### Return type

[**DataRequestListResponseDto**](DataRequestListResponseDto.md)

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


## dataRequestsControllerOptions

> DataRequestOptionsDto dataRequestsControllerOptions()

List eligible route groups, caller audience groups, and self-serve hint

### Example

```ts
import {
  Configuration,
  DataRequestsApi,
} from '@workspace/api-client';
import type { DataRequestsControllerOptionsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataRequestsApi();

  try {
    const data = await api.dataRequestsControllerOptions();
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

[**DataRequestOptionsDto**](DataRequestOptionsDto.md)

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


## dataRequestsControllerReplyComment

> ThreadResponseDto dataRequestsControllerReplyComment(id, threadId, addDataRequestCommentReplyDto)

Reply to a data request comment pin

### Example

```ts
import {
  Configuration,
  DataRequestsApi,
} from '@workspace/api-client';
import type { DataRequestsControllerReplyCommentRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataRequestsApi();

  const body = {
    // string
    id: id_example,
    // string
    threadId: threadId_example,
    // AddDataRequestCommentReplyDto
    addDataRequestCommentReplyDto: ...,
  } satisfies DataRequestsControllerReplyCommentRequest;

  try {
    const data = await api.dataRequestsControllerReplyComment(body);
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
| **threadId** | `string` |  | [Defaults to `undefined`] |
| **addDataRequestCommentReplyDto** | [AddDataRequestCommentReplyDto](AddDataRequestCommentReplyDto.md) |  | |

### Return type

[**ThreadResponseDto**](ThreadResponseDto.md)

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


## dataRequestsControllerRequestChanges

> DataRequestDetailDto dataRequestsControllerRequestChanges(id, requestChangesDto)

Request changes on a delivered data request

### Example

```ts
import {
  Configuration,
  DataRequestsApi,
} from '@workspace/api-client';
import type { DataRequestsControllerRequestChangesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataRequestsApi();

  const body = {
    // string
    id: id_example,
    // RequestChangesDto
    requestChangesDto: ...,
  } satisfies DataRequestsControllerRequestChangesRequest;

  try {
    const data = await api.dataRequestsControllerRequestChanges(body);
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
| **requestChangesDto** | [RequestChangesDto](RequestChangesDto.md) |  | |

### Return type

[**DataRequestDetailDto**](DataRequestDetailDto.md)

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


## dataRequestsControllerReroute

> DataRequestDetailDto dataRequestsControllerReroute(id, rerouteDataRequestDto)

Reroute a data request to another data-team group

### Example

```ts
import {
  Configuration,
  DataRequestsApi,
} from '@workspace/api-client';
import type { DataRequestsControllerRerouteRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataRequestsApi();

  const body = {
    // string
    id: id_example,
    // RerouteDataRequestDto
    rerouteDataRequestDto: ...,
  } satisfies DataRequestsControllerRerouteRequest;

  try {
    const data = await api.dataRequestsControllerReroute(body);
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
| **rerouteDataRequestDto** | [RerouteDataRequestDto](RerouteDataRequestDto.md) |  | |

### Return type

[**DataRequestDetailDto**](DataRequestDetailDto.md)

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


## dataRequestsControllerResolveComment

> ResolveDataRequestCommentResponseDto dataRequestsControllerResolveComment(id, threadId, resolveDataRequestCommentDto)

Resolve or reopen a data request comment pin

### Example

```ts
import {
  Configuration,
  DataRequestsApi,
} from '@workspace/api-client';
import type { DataRequestsControllerResolveCommentRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataRequestsApi();

  const body = {
    // string
    id: id_example,
    // string
    threadId: threadId_example,
    // ResolveDataRequestCommentDto
    resolveDataRequestCommentDto: ...,
  } satisfies DataRequestsControllerResolveCommentRequest;

  try {
    const data = await api.dataRequestsControllerResolveComment(body);
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
| **threadId** | `string` |  | [Defaults to `undefined`] |
| **resolveDataRequestCommentDto** | [ResolveDataRequestCommentDto](ResolveDataRequestCommentDto.md) |  | |

### Return type

[**ResolveDataRequestCommentResponseDto**](ResolveDataRequestCommentResponseDto.md)

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


## dataRequestsControllerSubmit

> DataRequestDetailDto dataRequestsControllerSubmit(id)

Submit a draft data request to the routed group

### Example

```ts
import {
  Configuration,
  DataRequestsApi,
} from '@workspace/api-client';
import type { DataRequestsControllerSubmitRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataRequestsApi();

  const body = {
    // string
    id: id_example,
  } satisfies DataRequestsControllerSubmitRequest;

  try {
    const data = await api.dataRequestsControllerSubmit(body);
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

[**DataRequestDetailDto**](DataRequestDetailDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## dataRequestsControllerUpdateSpec

> DataRequestDetailDto dataRequestsControllerUpdateSpec(id, updateDataRequestSpecDto)

Update the visual join canvas spec (optimistic concurrency)

### Example

```ts
import {
  Configuration,
  DataRequestsApi,
} from '@workspace/api-client';
import type { DataRequestsControllerUpdateSpecRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataRequestsApi();

  const body = {
    // string
    id: id_example,
    // UpdateDataRequestSpecDto
    updateDataRequestSpecDto: ...,
  } satisfies DataRequestsControllerUpdateSpecRequest;

  try {
    const data = await api.dataRequestsControllerUpdateSpec(body);
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
| **updateDataRequestSpecDto** | [UpdateDataRequestSpecDto](UpdateDataRequestSpecDto.md) |  | |

### Return type

[**DataRequestDetailDto**](DataRequestDetailDto.md)

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


## dataRequestsControllerUpdateSql

> DataRequestDetailDto dataRequestsControllerUpdateSql(id, updateDataRequestSqlDto)

Hand-edit or regenerate the request SQL (data team only)

### Example

```ts
import {
  Configuration,
  DataRequestsApi,
} from '@workspace/api-client';
import type { DataRequestsControllerUpdateSqlRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataRequestsApi();

  const body = {
    // string
    id: id_example,
    // UpdateDataRequestSqlDto
    updateDataRequestSqlDto: ...,
  } satisfies DataRequestsControllerUpdateSqlRequest;

  try {
    const data = await api.dataRequestsControllerUpdateSql(body);
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
| **updateDataRequestSqlDto** | [UpdateDataRequestSqlDto](UpdateDataRequestSqlDto.md) |  | |

### Return type

[**DataRequestDetailDto**](DataRequestDetailDto.md)

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


## dataRequestsControllerWithdraw

> DataRequestDetailDto dataRequestsControllerWithdraw(id)

Withdraw an open data request

### Example

```ts
import {
  Configuration,
  DataRequestsApi,
} from '@workspace/api-client';
import type { DataRequestsControllerWithdrawRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new DataRequestsApi();

  const body = {
    // string
    id: id_example,
  } satisfies DataRequestsControllerWithdrawRequest;

  try {
    const data = await api.dataRequestsControllerWithdraw(body);
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

[**DataRequestDetailDto**](DataRequestDetailDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** |  |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

