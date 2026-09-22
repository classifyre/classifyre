
# AssetSeverityCountsItemDto


## Properties

Name | Type
------------ | -------------
`assetId` | string
`total` | number
`severityCounts` | object

## Example

```typescript
import type { AssetSeverityCountsItemDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assetId": null,
  "total": null,
  "severityCounts": null,
} satisfies AssetSeverityCountsItemDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AssetSeverityCountsItemDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


