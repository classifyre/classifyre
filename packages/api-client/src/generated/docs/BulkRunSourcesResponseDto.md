
# BulkRunSourcesResponseDto


## Properties

Name | Type
------------ | -------------
`startedCount` | number
`ids` | Array&lt;string&gt;
`skipped` | [Array&lt;BulkRunSourcesSkippedDto&gt;](BulkRunSourcesSkippedDto.md)

## Example

```typescript
import type { BulkRunSourcesResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "startedCount": null,
  "ids": null,
  "skipped": null,
} satisfies BulkRunSourcesResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as BulkRunSourcesResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


