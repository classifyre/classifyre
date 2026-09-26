
# RejectedBoardOpDto


## Properties

Name | Type
------------ | -------------
`opId` | string
`reason` | string
`code` | string
`current` | { [key: string]: any; }

## Example

```typescript
import type { RejectedBoardOpDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "opId": null,
  "reason": null,
  "code": null,
  "current": null,
} satisfies RejectedBoardOpDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RejectedBoardOpDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


