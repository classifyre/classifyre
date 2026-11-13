
# AuditChangeDto


## Properties

Name | Type
------------ | -------------
`field` | string
`from` | string
`to` | string

## Example

```typescript
import type { AuditChangeDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "field": Owner,
  "from": null,
  "to": null,
} satisfies AuditChangeDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AuditChangeDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


