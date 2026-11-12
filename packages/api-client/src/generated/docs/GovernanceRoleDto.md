
# GovernanceRoleDto


## Properties

Name | Type
------------ | -------------
`id` | string
`role` | string
`principal` | [GovernancePrincipalDto](GovernancePrincipalDto.md)
`inherited` | boolean
`dateIn` | Date
`dateOut` | Date
`replacedByRef` | string
`assignedBy` | string
`removedBy` | string

## Example

```typescript
import type { GovernanceRoleDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "role": null,
  "principal": null,
  "inherited": null,
  "dateIn": null,
  "dateOut": null,
  "replacedByRef": null,
  "assignedBy": null,
  "removedBy": null,
} satisfies GovernanceRoleDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as GovernanceRoleDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


