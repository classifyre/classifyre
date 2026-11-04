
# TenantEventDto


## Properties

Name | Type
------------ | -------------
`id` | string
`occurredAt` | Date
`actor` | string
`action` | string
`detail` | object

## Example

```typescript
import type { TenantEventDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "occurredAt": null,
  "actor": null,
  "action": grant.added,
  "detail": null,
} satisfies TenantEventDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as TenantEventDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


