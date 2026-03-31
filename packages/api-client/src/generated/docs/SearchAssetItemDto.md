
# SearchAssetItemDto


## Properties

Name | Type
------------ | -------------
`asset` | [AssetListItemDto](AssetListItemDto.md)
`findings` | [Array&lt;SearchAssetFindingDto&gt;](SearchAssetFindingDto.md)

## Example

```typescript
import type { SearchAssetItemDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "asset": null,
  "findings": null,
} satisfies SearchAssetItemDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SearchAssetItemDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


