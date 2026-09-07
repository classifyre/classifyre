
# ConstellationBoundaryAssetDto


## Properties

Name | Type
------------ | -------------
`assetId` | string
`assetName` | string
`assetType` | string
`sourceId` | string
`edges` | [Array&lt;ConstellationBoundaryEdgeDto&gt;](ConstellationBoundaryEdgeDto.md)

## Example

```typescript
import type { ConstellationBoundaryAssetDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assetId": null,
  "assetName": null,
  "assetType": null,
  "sourceId": null,
  "edges": null,
} satisfies ConstellationBoundaryAssetDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ConstellationBoundaryAssetDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


