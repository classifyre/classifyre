
# BulkUpdateFindingsResponseDto


## Properties

Name | Type
------------ | -------------
`updatedCount` | number
`ids` | Array&lt;string&gt;
`wouldUpdate` | number
`narrowed` | boolean
`dryRun` | boolean
`operationId` | string
`async` | boolean
`total` | number

## Example

```typescript
import type { BulkUpdateFindingsResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "updatedCount": null,
  "ids": null,
  "wouldUpdate": null,
  "narrowed": null,
  "dryRun": null,
  "operationId": null,
  "async": null,
  "total": null,
} satisfies BulkUpdateFindingsResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as BulkUpdateFindingsResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


