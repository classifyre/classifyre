
# SearchSourcesRequestDto


## Properties

Name | Type
------------ | -------------
`filters` | [SearchSourcesFiltersDto](SearchSourcesFiltersDto.md)
`page` | [SearchSourcesPageDto](SearchSourcesPageDto.md)

## Example

```typescript
import type { SearchSourcesRequestDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "filters": null,
  "page": null,
} satisfies SearchSourcesRequestDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SearchSourcesRequestDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


