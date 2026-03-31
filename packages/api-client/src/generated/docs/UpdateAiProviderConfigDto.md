
# UpdateAiProviderConfigDto


## Properties

Name | Type
------------ | -------------
`provider` | string
`model` | string
`apiKey` | string
`baseUrl` | string

## Example

```typescript
import type { UpdateAiProviderConfigDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "provider": CLAUDE,
  "model": claude-sonnet-4-5,
  "apiKey": sk-proj-...,
  "baseUrl": https://openrouter.ai/api/v1,
} satisfies UpdateAiProviderConfigDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UpdateAiProviderConfigDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


