
# TenantDto


## Properties

Name | Type
------------ | -------------
`id` | string
`alias` | string
`name` | string
`displayName` | string
`capabilities` | Array&lt;string&gt;
`operator` | boolean
`visitor` | boolean
`organizationId` | string

## Example

```typescript
import type { TenantDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "alias": default,
  "name": Default,
  "displayName": null,
  "capabilities": null,
  "operator": null,
  "visitor": null,
  "organizationId": null,
} satisfies TenantDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as TenantDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


