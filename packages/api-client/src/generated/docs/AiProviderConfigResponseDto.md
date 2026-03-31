
# AiProviderConfigResponseDto


## Properties

Name | Type
------------ | -------------
`provider` | string
`model` | string
`hasApiKey` | boolean
`apiKeyPreview` | string
`baseUrl` | string
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { AiProviderConfigResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "provider": CLAUDE,
  "model": claude-sonnet-4-5,
  "hasApiKey": false,
  "apiKeyPreview": sk-p...xyz4,
  "baseUrl": https://openrouter.ai/api/v1,
  "createdAt": null,
  "updatedAt": null,
} satisfies AiProviderConfigResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AiProviderConfigResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


