
# GrantDto


## Properties

Name | Type
------------ | -------------
`id` | string
`subjectType` | string
`subjectId` | string
`subjectLabel` | string
`roleKey` | string
`scopeType` | string
`scopeId` | string
`scopeLabel` | string
`expiresAt` | Date
`inherited` | boolean
`sourceId` | string

## Example

```typescript
import type { GrantDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "subjectType": null,
  "subjectId": null,
  "subjectLabel": /finance,
  "roleKey": viewer,
  "scopeType": null,
  "scopeId": null,
  "scopeLabel": Workspaces of /finance,
  "expiresAt": null,
  "inherited": null,
  "sourceId": null,
} satisfies GrantDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as GrantDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


