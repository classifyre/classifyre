
# BulkDeleteRunnersDto


## Properties

Name | Type
------------ | -------------
`ids` | Array&lt;string&gt;
`filters` | [SearchRunnersFiltersInputDto](SearchRunnersFiltersInputDto.md)

## Example

```typescript
import type { BulkDeleteRunnersDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "ids": null,
  "filters": null,
} satisfies BulkDeleteRunnersDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as BulkDeleteRunnersDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


