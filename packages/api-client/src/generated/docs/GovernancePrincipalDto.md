
# GovernancePrincipalDto


## Properties

Name | Type
------------ | -------------
`ref` | string
`kind` | string
`displayName` | string
`email` | string
`path` | string

## Example

```typescript
import type { GovernancePrincipalDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "ref": user:5c1f…,
  "kind": null,
  "displayName": Jordan Reyes,
  "email": jordan@example.org,
  "path": /finance/controlling,
} satisfies GovernancePrincipalDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as GovernancePrincipalDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


