
# DataRequestDetailDto


## Properties

Name | Type
------------ | -------------
`id` | string
`kind` | string
`title` | string
`description` | string
`status` | string
`priority` | string
`state` | string
`requester` | [DataRequestActorRefDto](DataRequestActorRefDto.md)
`routeGroup` | [DataRequestGroupRefDto](DataRequestGroupRefDto.md)
`audienceGroup` | [DataRequestGroupRefDto](DataRequestGroupRefDto.md)
`assignee` | [DataRequestActorRefDto](DataRequestActorRefDto.md)
`datasetAssetId` | string
`datasetName` | string
`deliveredVersion` | number
`declineReason` | string
`submittedAt` | Date
`deliveredAt` | Date
`closedAt` | Date
`createdAt` | Date
`updatedAt` | Date
`spec` | { [key: string]: any; }
`specVersion` | number
`draftSql` | string
`sqlEdited` | boolean
`lastCheck` | { [key: string]: any; }
`lastCheckSqlHash` | string
`dataset` | [DataRequestLiveDatasetDto](DataRequestLiveDatasetDto.md)
`deliveries` | [Array&lt;DataRequestDeliveryDto&gt;](DataRequestDeliveryDto.md)
`threads` | [Array&lt;DataRequestCommentThreadDto&gt;](DataRequestCommentThreadDto.md)
`permissions` | [DataRequestPermissionsDto](DataRequestPermissionsDto.md)

## Example

```typescript
import type { DataRequestDetailDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "kind": null,
  "title": null,
  "description": null,
  "status": null,
  "priority": null,
  "state": null,
  "requester": null,
  "routeGroup": null,
  "audienceGroup": null,
  "assignee": null,
  "datasetAssetId": null,
  "datasetName": null,
  "deliveredVersion": null,
  "declineReason": null,
  "submittedAt": null,
  "deliveredAt": null,
  "closedAt": null,
  "createdAt": null,
  "updatedAt": null,
  "spec": null,
  "specVersion": null,
  "draftSql": null,
  "sqlEdited": null,
  "lastCheck": null,
  "lastCheckSqlHash": null,
  "dataset": null,
  "deliveries": null,
  "threads": null,
  "permissions": null,
} satisfies DataRequestDetailDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as DataRequestDetailDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


