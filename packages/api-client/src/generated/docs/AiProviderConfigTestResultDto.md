
# AiProviderConfigTestResultDto


## Properties

Name | Type
------------ | -------------
`provider` | string
`model` | string

## Example

```typescript
import type { AiProviderConfigTestResultDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "provider": CLAUDE,
  "model": claude-sonnet-4-5,
} satisfies AiProviderConfigTestResultDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AiProviderConfigTestResultDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


