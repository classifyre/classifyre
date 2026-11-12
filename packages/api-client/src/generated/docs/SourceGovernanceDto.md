
# SourceGovernanceDto


## Properties

Name | Type
------------ | -------------
`sourceId` | string
`roles` | [Array&lt;GovernanceRoleDto&gt;](GovernanceRoleDto.md)
`history` | [Array&lt;GovernanceRoleDto&gt;](GovernanceRoleDto.md)
`coverage` | [SourceGovernanceCoverageDto](SourceGovernanceCoverageDto.md)
`canGovern` | boolean
`canAssignRoles` | boolean

## Example

```typescript
import type { SourceGovernanceDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "sourceId": null,
  "roles": null,
  "history": null,
  "coverage": null,
  "canGovern": null,
  "canAssignRoles": null,
} satisfies SourceGovernanceDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SourceGovernanceDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


