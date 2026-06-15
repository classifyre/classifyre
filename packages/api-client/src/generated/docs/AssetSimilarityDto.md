
# AssetSimilarityDto


## Properties

Name | Type
------------ | -------------
`fromId` | string
`toId` | string
`weighted` | number
`relationType` | string

## Example

```typescript
import type { AssetSimilarityDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "fromId": null,
  "toId": null,
  "weighted": null,
  "relationType": null,
} satisfies AssetSimilarityDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AssetSimilarityDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


