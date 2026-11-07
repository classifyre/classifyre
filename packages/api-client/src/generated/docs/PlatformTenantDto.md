
# PlatformTenantDto


## Properties

Name | Type
------------ | -------------
`id` | string
`alias` | string
`name` | string
`status` | string
`createdAt` | Date
`workspaces` | number
`members` | number
`admins` | [Array&lt;TenantAdminDto&gt;](TenantAdminDto.md)
`lastActivityAt` | Date
`database` | string
`upgradeError` | string
`problem` | string

## Example

```typescript
import type { PlatformTenantDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "alias": acme,
  "name": Acme,
  "status": null,
  "createdAt": null,
  "workspaces": null,
  "members": null,
  "admins": null,
  "lastActivityAt": null,
  "database": null,
  "upgradeError": null,
  "problem": null,
} satisfies PlatformTenantDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as PlatformTenantDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


