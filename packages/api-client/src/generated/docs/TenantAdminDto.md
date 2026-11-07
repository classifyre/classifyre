
# TenantAdminDto


## Properties

Name | Type
------------ | -------------
`id` | string
`name` | string
`email` | string

## Example

```typescript
import type { TenantAdminDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "name": Ada Kowalczyk,
  "email": null,
} satisfies TenantAdminDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as TenantAdminDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


