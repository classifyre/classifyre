
# BulkUpdateSourcesSamplingDto


## Properties

Name | Type
------------ | -------------
`strategy` | string
`orderByColumn` | string
`fallbackToRandom` | boolean
`rowsPerPage` | number
`includeColumnNames` | boolean

## Example

```typescript
import type { BulkUpdateSourcesSamplingDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "strategy": null,
  "orderByColumn": null,
  "fallbackToRandom": null,
  "rowsPerPage": null,
  "includeColumnNames": null,
} satisfies BulkUpdateSourcesSamplingDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as BulkUpdateSourcesSamplingDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


