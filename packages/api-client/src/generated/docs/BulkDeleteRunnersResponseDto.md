
# BulkDeleteRunnersResponseDto


## Properties

Name | Type
------------ | -------------
`deletedCount` | number
`ids` | Array&lt;string&gt;
`skipped` | [Array&lt;BulkRunnersSkippedDto&gt;](BulkRunnersSkippedDto.md)

## Example

```typescript
import type { BulkDeleteRunnersResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "deletedCount": null,
  "ids": null,
  "skipped": null,
} satisfies BulkDeleteRunnersResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as BulkDeleteRunnersResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


