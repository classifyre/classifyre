
# CreateAccessRequestDto


## Properties

Name | Type
------------ | -------------
`scopeType` | string
`scopeId` | string
`groupId` | string
`roleKey` | string
`reason` | string
`durationDays` | number

## Example

```typescript
import type { CreateAccessRequestDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "scopeType": null,
  "scopeId": null,
  "groupId": null,
  "roleKey": null,
  "reason": null,
  "durationDays": null,
} satisfies CreateAccessRequestDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CreateAccessRequestDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


