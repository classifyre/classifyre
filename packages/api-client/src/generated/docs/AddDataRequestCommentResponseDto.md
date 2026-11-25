
# AddDataRequestCommentResponseDto


## Properties

Name | Type
------------ | -------------
`thread` | [DataRequestCommentThreadDto](DataRequestCommentThreadDto.md)
`pin` | [DataRequestPinDto](DataRequestPinDto.md)
`specVersion` | number

## Example

```typescript
import type { AddDataRequestCommentResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "thread": null,
  "pin": null,
  "specVersion": null,
} satisfies AddDataRequestCommentResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AddDataRequestCommentResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


