
# SearchAssetsRequestDto


## Properties

Name | Type
------------ | -------------
`assets` | [SearchAssetsFiltersDto](SearchAssetsFiltersDto.md)
`findings` | [SearchFindingsFiltersDto](SearchFindingsFiltersDto.md)
`page` | [SearchAssetsPageDto](SearchAssetsPageDto.md)
`options` | [SearchAssetsOptionsDto](SearchAssetsOptionsDto.md)

## Example

```typescript
import type { SearchAssetsRequestDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assets": null,
  "findings": null,
  "page": null,
  "options": null,
} satisfies SearchAssetsRequestDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SearchAssetsRequestDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


