
# CreateGrantDto


## Properties

Name | Type
------------ | -------------
`subjectType` | string
`subjectId` | string
`roleKey` | string
`scopeType` | string
`resourceId` | string
`scopeId` | string
`expiresAt` | Date

## Example

```typescript
import type { CreateGrantDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "subjectType": null,
  "subjectId": null,
  "roleKey": viewer,
  "scopeType": null,
  "resourceId": null,
  "scopeId": null,
  "expiresAt": null,
} satisfies CreateGrantDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CreateGrantDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


