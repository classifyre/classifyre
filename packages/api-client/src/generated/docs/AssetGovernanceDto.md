
# AssetGovernanceDto


## Properties

Name | Type
------------ | -------------
`assetId` | string
`sourceId` | string
`governed` | boolean
`status` | string
`description` | string
`usage` | string
`limitations` | string
`legalBasis` | string
`retention` | string
`certifiedAt` | Date
`certifiedBy` | string
`updatedAt` | Date
`updatedBy` | string
`roles` | [Array&lt;GovernanceRoleDto&gt;](GovernanceRoleDto.md)
`history` | [Array&lt;GovernanceRoleDto&gt;](GovernanceRoleDto.md)
`checklist` | [Array&lt;GovernanceChecklistItemDto&gt;](GovernanceChecklistItemDto.md)
`canGovern` | boolean
`canAssignRoles` | boolean

## Example

```typescript
import type { AssetGovernanceDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assetId": null,
  "sourceId": null,
  "governed": null,
  "status": null,
  "description": null,
  "usage": null,
  "limitations": null,
  "legalBasis": null,
  "retention": null,
  "certifiedAt": null,
  "certifiedBy": null,
  "updatedAt": null,
  "updatedBy": null,
  "roles": null,
  "history": null,
  "checklist": null,
  "canGovern": null,
  "canAssignRoles": null,
} satisfies AssetGovernanceDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AssetGovernanceDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


