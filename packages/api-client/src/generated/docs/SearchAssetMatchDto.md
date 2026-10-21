
# SearchAssetMatchDto


## Properties

Name | Type
------------ | -------------
`score` | number
`page` | number
`text` | string
`via` | string

## Example

```typescript
import type { SearchAssetMatchDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "score": null,
  "page": null,
  "text": null,
  "via": null,
} satisfies SearchAssetMatchDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SearchAssetMatchDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


