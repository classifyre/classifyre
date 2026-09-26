
# QuickSearchResponseDto


## Properties

Name | Type
------------ | -------------
`assets` | [Array&lt;QuickSearchAssetDto&gt;](QuickSearchAssetDto.md)
`findings` | [Array&lt;QuickSearchFindingDto&gt;](QuickSearchFindingDto.md)
`truncated` | boolean

## Example

```typescript
import type { QuickSearchResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assets": null,
  "findings": null,
  "truncated": null,
} satisfies QuickSearchResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as QuickSearchResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


