
# BulkUpdateGlossaryTermsDto


## Properties

Name | Type
------------ | -------------
`ids` | Array&lt;string&gt;
`filters` | [BulkUpdateGlossaryFiltersDto](BulkUpdateGlossaryFiltersDto.md)
`verified` | boolean
`entityType` | string
`verifiedBy` | string

## Example

```typescript
import type { BulkUpdateGlossaryTermsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "ids": null,
  "filters": null,
  "verified": null,
  "entityType": null,
  "verifiedBy": null,
} satisfies BulkUpdateGlossaryTermsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as BulkUpdateGlossaryTermsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


