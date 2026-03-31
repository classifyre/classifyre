
# SearchAssetsResponseDto


## Properties

Name | Type
------------ | -------------
`items` | [Array&lt;SearchAssetItemDto&gt;](SearchAssetItemDto.md)
`total` | number
`skip` | number
`limit` | number

## Example

```typescript
import type { SearchAssetsResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "items": null,
  "total": null,
  "skip": null,
  "limit": null,
} satisfies SearchAssetsResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SearchAssetsResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


