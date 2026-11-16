
# AccessRequestDto


## Properties

Name | Type
------------ | -------------
`id` | string
`scopeType` | string
`scopeId` | string
`sourceId` | string
`targetName` | string
`sqlName` | string
`requesterRef` | string
`requesterName` | string
`groupId` | string
`groupName` | string
`groupPath` | string
`roleKey` | string
`reason` | string
`durationDays` | number
`status` | string
`createdAt` | Date
`decidedBy` | string
`decidedByName` | string
`decidedAt` | Date
`decisionNote` | string
`grantExpiresAt` | Date
`canDecide` | boolean
`canWithdraw` | boolean

## Example

```typescript
import type { AccessRequestDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "scopeType": null,
  "scopeId": null,
  "sourceId": null,
  "targetName": customers,
  "sqlName": shop_lake.shop.customers,
  "requesterRef": user:5c1f…,
  "requesterName": null,
  "groupId": null,
  "groupName": null,
  "groupPath": null,
  "roleKey": null,
  "reason": null,
  "durationDays": null,
  "status": null,
  "createdAt": null,
  "decidedBy": null,
  "decidedByName": null,
  "decidedAt": null,
  "decisionNote": null,
  "grantExpiresAt": null,
  "canDecide": null,
  "canWithdraw": null,
} satisfies AccessRequestDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AccessRequestDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


