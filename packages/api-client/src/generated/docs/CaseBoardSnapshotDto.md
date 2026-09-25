
# CaseBoardSnapshotDto


## Properties

Name | Type
------------ | -------------
`id` | string
`reason` | string
`version` | number
`createdBy` | string
`createdAt` | Date
`payload` | [CaseBoardResponseDto](CaseBoardResponseDto.md)

## Example

```typescript
import type { CaseBoardSnapshotDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "reason": null,
  "version": null,
  "createdBy": null,
  "createdAt": null,
  "payload": null,
} satisfies CaseBoardSnapshotDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseBoardSnapshotDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


