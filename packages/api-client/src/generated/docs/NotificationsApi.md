# NotificationsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**notificationsControllerAudiences**](NotificationsApi.md#notificationscontrolleraudiences) | **GET** /notifications/audiences | Which groups get each kind of notification |
| [**notificationsControllerDeleteNotification**](NotificationsApi.md#notificationscontrollerdeletenotification) | **DELETE** /notifications/{id} | Dismiss a notification |
| [**notificationsControllerListNotifications**](NotificationsApi.md#notificationscontrollerlistnotifications) | **GET** /notifications | List notifications |
| [**notificationsControllerMarkAllRead**](NotificationsApi.md#notificationscontrollermarkallread) | **PATCH** /notifications/mark-all-read | Mark all your notifications as read |
| [**notificationsControllerMarkRead**](NotificationsApi.md#notificationscontrollermarkread) | **PATCH** /notifications/{id}/read | Mark a notification as read |
| [**notificationsControllerSetAudience**](NotificationsApi.md#notificationscontrollersetaudience) | **PUT** /notifications/audiences/{type} | Choose which groups get a kind of notification |
| [**notificationsControllerSetImportant**](NotificationsApi.md#notificationscontrollersetimportant) | **PATCH** /notifications/{id}/important | Set notification importance |



## notificationsControllerAudiences

> Array&lt;NotificationAudienceDto&gt; notificationsControllerAudiences()

Which groups get each kind of notification

An empty list means the workspace\&#39;s owning group. A notification keeps the groups it was sent to.

### Example

```ts
import {
  Configuration,
  NotificationsApi,
} from '@workspace/api-client';
import type { NotificationsControllerAudiencesRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new NotificationsApi();

  try {
    const data = await api.notificationsControllerAudiences();
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

[**Array&lt;NotificationAudienceDto&gt;**](NotificationAudienceDto.md)

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


## notificationsControllerDeleteNotification

> NotificationsControllerDeleteNotification200Response notificationsControllerDeleteNotification(id)

Dismiss a notification

Hides it for you only; everyone else in its groups keeps it.

### Example

```ts
import {
  Configuration,
  NotificationsApi,
} from '@workspace/api-client';
import type { NotificationsControllerDeleteNotificationRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new NotificationsApi();

  const body = {
    // string | Notification ID
    id: a1b2c3d4-e5f6-7890-abcd-ef1234567890,
  } satisfies NotificationsControllerDeleteNotificationRequest;

  try {
    const data = await api.notificationsControllerDeleteNotification(body);
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
| **id** | `string` | Notification ID | [Defaults to `undefined`] |

### Return type

[**NotificationsControllerDeleteNotification200Response**](NotificationsControllerDeleteNotification200Response.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Notification dismissed for you |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## notificationsControllerListNotifications

> NotificationListResponseDto notificationsControllerListNotifications(type, event, severity, sourceId, runnerId, findingId, unreadOnly, importantOnly, skip, take)

List notifications

Retrieve notifications with optional filters and pagination.

### Example

```ts
import {
  Configuration,
  NotificationsApi,
} from '@workspace/api-client';
import type { NotificationsControllerListNotificationsRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new NotificationsApi();

  const body = {
    // 'SCAN' | 'FINDING' | 'SOURCE' | 'SYSTEM' (optional)
    type: type_example,
    // string (optional)
    event: event_example,
    // 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO' (optional)
    severity: severity_example,
    // string (optional)
    sourceId: sourceId_example,
    // string (optional)
    runnerId: runnerId_example,
    // string (optional)
    findingId: findingId_example,
    // boolean (optional)
    unreadOnly: true,
    // boolean (optional)
    importantOnly: true,
    // number (optional)
    skip: 8.14,
    // number (optional)
    take: 8.14,
  } satisfies NotificationsControllerListNotificationsRequest;

  try {
    const data = await api.notificationsControllerListNotifications(body);
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
| **type** | `SCAN`, `FINDING`, `SOURCE`, `SYSTEM` |  | [Optional] [Defaults to `undefined`] [Enum: SCAN, FINDING, SOURCE, SYSTEM] |
| **event** | `string` |  | [Optional] [Defaults to `undefined`] |
| **severity** | `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFO` |  | [Optional] [Defaults to `undefined`] [Enum: CRITICAL, HIGH, MEDIUM, LOW, INFO] |
| **sourceId** | `string` |  | [Optional] [Defaults to `undefined`] |
| **runnerId** | `string` |  | [Optional] [Defaults to `undefined`] |
| **findingId** | `string` |  | [Optional] [Defaults to `undefined`] |
| **unreadOnly** | `boolean` |  | [Optional] [Defaults to `false`] |
| **importantOnly** | `boolean` |  | [Optional] [Defaults to `false`] |
| **skip** | `number` |  | [Optional] [Defaults to `0`] |
| **take** | `number` |  | [Optional] [Defaults to `50`] |

### Return type

[**NotificationListResponseDto**](NotificationListResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | List of notifications |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## notificationsControllerMarkAllRead

> NotificationsControllerMarkAllRead200Response notificationsControllerMarkAllRead(markAllReadDto)

Mark all your notifications as read

Marks every unread notification you get as read, for you. Optional filters can narrow the update.

### Example

```ts
import {
  Configuration,
  NotificationsApi,
} from '@workspace/api-client';
import type { NotificationsControllerMarkAllReadRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new NotificationsApi();

  const body = {
    // MarkAllReadDto
    markAllReadDto: {},
  } satisfies NotificationsControllerMarkAllReadRequest;

  try {
    const data = await api.notificationsControllerMarkAllRead(body);
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
| **markAllReadDto** | [MarkAllReadDto](MarkAllReadDto.md) |  | |

### Return type

[**NotificationsControllerMarkAllRead200Response**](NotificationsControllerMarkAllRead200Response.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Notifications marked as read |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## notificationsControllerMarkRead

> NotificationResponseDto notificationsControllerMarkRead(id)

Mark a notification as read

### Example

```ts
import {
  Configuration,
  NotificationsApi,
} from '@workspace/api-client';
import type { NotificationsControllerMarkReadRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new NotificationsApi();

  const body = {
    // string | Notification ID
    id: a1b2c3d4-e5f6-7890-abcd-ef1234567890,
  } satisfies NotificationsControllerMarkReadRequest;

  try {
    const data = await api.notificationsControllerMarkRead(body);
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
| **id** | `string` | Notification ID | [Defaults to `undefined`] |

### Return type

[**NotificationResponseDto**](NotificationResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Notification marked as read |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## notificationsControllerSetAudience

> NotificationAudienceDto notificationsControllerSetAudience(type, updateNotificationAudienceDto)

Choose which groups get a kind of notification

Groups of your tenant; an empty list sends it to the owning group again. Applies to notifications made from now on.

### Example

```ts
import {
  Configuration,
  NotificationsApi,
} from '@workspace/api-client';
import type { NotificationsControllerSetAudienceRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new NotificationsApi();

  const body = {
    // 'SCAN' | 'FINDING' | 'SOURCE' | 'SYSTEM'
    type: type_example,
    // UpdateNotificationAudienceDto
    updateNotificationAudienceDto: ...,
  } satisfies NotificationsControllerSetAudienceRequest;

  try {
    const data = await api.notificationsControllerSetAudience(body);
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
| **type** | `SCAN`, `FINDING`, `SOURCE`, `SYSTEM` |  | [Defaults to `undefined`] [Enum: SCAN, FINDING, SOURCE, SYSTEM] |
| **updateNotificationAudienceDto** | [UpdateNotificationAudienceDto](UpdateNotificationAudienceDto.md) |  | |

### Return type

[**NotificationAudienceDto**](NotificationAudienceDto.md)

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


## notificationsControllerSetImportant

> NotificationResponseDto notificationsControllerSetImportant(id, updateNotificationImportanceDto)

Set notification importance

### Example

```ts
import {
  Configuration,
  NotificationsApi,
} from '@workspace/api-client';
import type { NotificationsControllerSetImportantRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new NotificationsApi();

  const body = {
    // string | Notification ID
    id: a1b2c3d4-e5f6-7890-abcd-ef1234567890,
    // UpdateNotificationImportanceDto
    updateNotificationImportanceDto: ...,
  } satisfies NotificationsControllerSetImportantRequest;

  try {
    const data = await api.notificationsControllerSetImportant(body);
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
| **id** | `string` | Notification ID | [Defaults to `undefined`] |
| **updateNotificationImportanceDto** | [UpdateNotificationImportanceDto](UpdateNotificationImportanceDto.md) |  | |

### Return type

[**NotificationResponseDto**](NotificationResponseDto.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Notification importance updated |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

