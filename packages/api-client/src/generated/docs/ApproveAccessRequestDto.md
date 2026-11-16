
# ApproveAccessRequestDto


## Properties

Name | Type
------------ | -------------
`roleKey` | string
`durationDays` | number
`note` | string

## Example

```typescript
import type { ApproveAccessRequestDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "roleKey": null,
  "durationDays": null,
  "note": null,
} satisfies ApproveAccessRequestDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ApproveAccessRequestDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


