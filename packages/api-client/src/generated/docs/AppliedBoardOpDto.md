
# AppliedBoardOpDto


## Properties

Name | Type
------------ | -------------
`opId` | string
`id` | string
`updatedAt` | Date
`note` | string

## Example

```typescript
import type { AppliedBoardOpDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "opId": null,
  "id": null,
  "updatedAt": null,
  "note": null,
} satisfies AppliedBoardOpDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AppliedBoardOpDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


