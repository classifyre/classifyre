
# AddTenantAdminDto


## Properties

Name | Type
------------ | -------------
`email` | string
`firstName` | string
`lastName` | string

## Example

```typescript
import type { AddTenantAdminDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "email": ada@example.test,
  "firstName": Ada,
  "lastName": Kowalczyk,
} satisfies AddTenantAdminDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AddTenantAdminDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


