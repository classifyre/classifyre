
# DataRequestDeliveryDto


## Properties

Name | Type
------------ | -------------
`id` | string
`round` | number
`datasetAssetId` | string
`datasetName` | string
`datasetVersion` | number
`sqlSnapshot` | string
`specSnapshot` | { [key: string]: any; }
`mode` | string
`deliveredBy` | [DataRequestActorRefDto](DataRequestActorRefDto.md)
`note` | string
`createdAt` | Date

## Example

```typescript
import type { DataRequestDeliveryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "round": null,
  "datasetAssetId": null,
  "datasetName": null,
  "datasetVersion": null,
  "sqlSnapshot": null,
  "specSnapshot": null,
  "mode": null,
  "deliveredBy": null,
  "note": null,
  "createdAt": null,
} satisfies DataRequestDeliveryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as DataRequestDeliveryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


