
# TenantGroupDto


## Properties

Name | Type
------------ | -------------
`id` | string
`name` | string
`path` | string
`parentId` | string

## Example

```typescript
import type { TenantGroupDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "name": workspace-managers,
  "path": /finance/workspace-managers,
  "parentId": null,
} satisfies TenantGroupDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as TenantGroupDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


