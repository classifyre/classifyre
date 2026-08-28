
# ReviewPairAssetDto


## Properties

Name | Type
------------ | -------------
`id` | string
`name` | string
`assetType` | string
`sourceId` | string
`sourceName` | string
`externalUrl` | string
`lineageDegree` | number

## Example

```typescript
import type { ReviewPairAssetDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "name": null,
  "assetType": null,
  "sourceId": null,
  "sourceName": null,
  "externalUrl": null,
  "lineageDegree": null,
} satisfies ReviewPairAssetDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ReviewPairAssetDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


