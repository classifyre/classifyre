
# ValueOccurrenceAssetDto


## Properties

Name | Type
------------ | -------------
`assetId` | string
`name` | string
`externalUrl` | string
`assetType` | string
`sourceType` | string
`sourceId` | string
`sourceName` | string
`clusterId` | string

## Example

```typescript
import type { ValueOccurrenceAssetDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assetId": null,
  "name": null,
  "externalUrl": null,
  "assetType": null,
  "sourceType": null,
  "sourceId": null,
  "sourceName": null,
  "clusterId": null,
} satisfies ValueOccurrenceAssetDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ValueOccurrenceAssetDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


