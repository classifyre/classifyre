# NotificationsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**notificationsControllerDeleteNotification**](NotificationsApi.md#notificationscontrollerdeletenotification) | **DELETE** /notifications/{id} | Delete a notification |
| [**notificationsControllerListNotifications**](NotificationsApi.md#notificationscontrollerlistnotifications) | **GET** /notifications | List notifications |
| [**notificationsControllerMarkAllRead**](NotificationsApi.md#notificationscontrollermarkallread) | **PATCH** /notifications/mark-all-read | Mark all notifications as read |
| [**notificationsControllerMarkRead**](NotificationsApi.md#notificationscontrollermarkread) | **PATCH** /notifications/{id}/read | Mark a notification as read |
| [**notificationsControllerSetImportant**](NotificationsApi.md#notificationscontrollersetimportant) | **PATCH** /notifications/{id}/important | Set notification importance |



## notificationsControllerDeleteNotification

> NotificationsControllerDeleteNotification200Response notificationsControllerDeleteNotification(id)

Delete a notification

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
| **200** | Notification deleted |  -  |

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

Mark all notifications as read

Marks all unread notifications as read. Optional filters can narrow the update.

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

