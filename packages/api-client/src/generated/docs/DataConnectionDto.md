
# DataConnectionDto


## Properties

Name | Type
------------ | -------------
`id` | string
`name` | string
`personRef` | string
`username` | string
`secretPreview` | string
`status` | string
`scope` | [Array&lt;DataConnectionScopeItemDto&gt;](DataConnectionScopeItemDto.md)
`blocks` | [Array&lt;DataConnectionBlockDto&gt;](DataConnectionBlockDto.md)
`issuedBy` | string
`expiresAt` | Date
`lastUsedAt` | Date
`lastUsedIp` | string
`revokedAt` | Date
`revokedBy` | string
`revokeReason` | string
`createdAt` | Date
`canRevoke` | boolean
`reads` | [DataConnectionReadsDto](DataConnectionReadsDto.md)

## Example

```typescript
import type { DataConnectionDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "name": null,
  "personRef": null,
  "username": null,
  "secretPreview": null,
  "status": null,
  "scope": null,
  "blocks": null,
  "issuedBy": null,
  "expiresAt": null,
  "lastUsedAt": null,
  "lastUsedIp": null,
  "revokedAt": null,
  "revokedBy": null,
  "revokeReason": null,
  "createdAt": null,
  "canRevoke": null,
  "reads": null,
} satisfies DataConnectionDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as DataConnectionDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


