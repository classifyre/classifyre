# SemanticLayerQueryApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**metricQueryControllerExplore**](SemanticLayerQueryApi.md#metricquerycontrollerexplore) | **POST** /semantic/query/explore | Explore detection data through a glossary term with metric breakdown |
| [**metricQueryControllerQueryDashboard**](SemanticLayerQueryApi.md#metricquerycontrollerquerydashboard) | **POST** /semantic/query/dashboard | Batch-evaluate all metrics placed on a dashboard |
| [**metricQueryControllerQueryMetric**](SemanticLayerQueryApi.md#metricquerycontrollerquerymetric) | **POST** /semantic/query | Evaluate a metric with optional dimensions and filters |
| [**metricQueryControllerQueryTimeSeries**](SemanticLayerQueryApi.md#metricquerycontrollerquerytimeseries) | **POST** /semantic/query/timeseries | Evaluate a metric as a time series |



## metricQueryControllerExplore

> metricQueryControllerExplore()

Explore detection data through a glossary term with metric breakdown

### Example

```ts
import {
  Configuration,
  SemanticLayerQueryApi,
} from '@workspace/api-client';
import type { MetricQueryControllerExploreRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticLayerQueryApi();

  try {
    const data = await api.metricQueryControllerExplore();
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


## metricQueryControllerQueryDashboard

> metricQueryControllerQueryDashboard(queryDashboardMetricsDto)

Batch-evaluate all metrics placed on a dashboard

### Example

```ts
import {
  Configuration,
  SemanticLayerQueryApi,
} from '@workspace/api-client';
import type { MetricQueryControllerQueryDashboardRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticLayerQueryApi();

  const body = {
    // QueryDashboardMetricsDto
    queryDashboardMetricsDto: ...,
  } satisfies MetricQueryControllerQueryDashboardRequest;

  try {
    const data = await api.metricQueryControllerQueryDashboard(body);
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
| **queryDashboardMetricsDto** | [QueryDashboardMetricsDto](QueryDashboardMetricsDto.md) |  | |

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


## metricQueryControllerQueryMetric

> metricQueryControllerQueryMetric(queryMetricDto)

Evaluate a metric with optional dimensions and filters

### Example

```ts
import {
  Configuration,
  SemanticLayerQueryApi,
} from '@workspace/api-client';
import type { MetricQueryControllerQueryMetricRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticLayerQueryApi();

  const body = {
    // QueryMetricDto
    queryMetricDto: ...,
  } satisfies MetricQueryControllerQueryMetricRequest;

  try {
    const data = await api.metricQueryControllerQueryMetric(body);
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
| **queryMetricDto** | [QueryMetricDto](QueryMetricDto.md) |  | |

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


## metricQueryControllerQueryTimeSeries

> metricQueryControllerQueryTimeSeries(queryMetricTimeSeriesDto)

Evaluate a metric as a time series

### Example

```ts
import {
  Configuration,
  SemanticLayerQueryApi,
} from '@workspace/api-client';
import type { MetricQueryControllerQueryTimeSeriesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new SemanticLayerQueryApi();

  const body = {
    // QueryMetricTimeSeriesDto
    queryMetricTimeSeriesDto: ...,
  } satisfies MetricQueryControllerQueryTimeSeriesRequest;

  try {
    const data = await api.metricQueryControllerQueryTimeSeries(body);
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
| **queryMetricTimeSeriesDto** | [QueryMetricTimeSeriesDto](QueryMetricTimeSeriesDto.md) |  | |

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

