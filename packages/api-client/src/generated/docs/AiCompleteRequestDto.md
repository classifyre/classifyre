
# AiCompleteRequestDto


## Properties

Name | Type
------------ | -------------
`messages` | [Array&lt;AiMessageDto&gt;](AiMessageDto.md)

## Example

```typescript
import type { AiCompleteRequestDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "messages": null,
} satisfies AiCompleteRequestDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AiCompleteRequestDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


