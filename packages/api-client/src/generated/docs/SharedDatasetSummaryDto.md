
# SharedDatasetSummaryDto


## Properties

Name | Type
------------ | -------------
`assetId` | string
`sqlName` | string
`domain` | string
`name` | string
`description` | string
`owningGroup` | [SharedDatasetGroupDto](SharedDatasetGroupDto.md)
`owner` | [SharedDatasetActorDto](SharedDatasetActorDto.md)
`lifecycle` | string
`promoted` | boolean
`state` | string
`stateReason` | string
`inputCount` | number
`canQuery` | boolean
`version` | number
`updatedAt` | Date

## Example

```typescript
import type { SharedDatasetSummaryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assetId": null,
  "sqlName": shared.sales.orders_by_region,
  "domain": null,
  "name": null,
  "description": null,
  "owningGroup": null,
  "owner": null,
  "lifecycle": ACTIVE,
  "promoted": null,
  "state": null,
  "stateReason": null,
  "inputCount": null,
  "canQuery": null,
  "version": null,
  "updatedAt": null,
} satisfies SharedDatasetSummaryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SharedDatasetSummaryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


