
# SharedDatasetBlockDto


## Properties

Name | Type
------------ | -------------
`id` | string
`scopeType` | string
`reason` | string
`blockedBy` | [SharedDatasetActorDto](SharedDatasetActorDto.md)
`blockedAt` | Date

## Example

```typescript
import type { SharedDatasetBlockDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "scopeType": null,
  "reason": null,
  "blockedBy": null,
  "blockedAt": null,
} satisfies SharedDatasetBlockDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SharedDatasetBlockDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


