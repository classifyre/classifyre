
# AiCompleteResponseDto


## Properties

Name | Type
------------ | -------------
`content` | string
`model` | string
`provider` | string

## Example

```typescript
import type { AiCompleteResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "content": null,
  "model": null,
  "provider": null,
} satisfies AiCompleteResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AiCompleteResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


