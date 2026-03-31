
# McpTokenResponseDto


## Properties

Name | Type
------------ | -------------
`id` | string
`name` | string
`tokenPreview` | string
`isActive` | boolean
`lastUsedAt` | Date
`revokedAt` | Date
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { McpTokenResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": 6c0ae0a4-2740-4c37-aa29-c9c69522e053,
  "name": Cursor local agent,
  "tokenPreview": inmcp_6c0ae0a4...VC-TM,
  "isActive": true,
  "lastUsedAt": null,
  "revokedAt": null,
  "createdAt": null,
  "updatedAt": null,
} satisfies McpTokenResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as McpTokenResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


