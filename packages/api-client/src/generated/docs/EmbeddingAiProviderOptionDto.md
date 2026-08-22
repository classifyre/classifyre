
# EmbeddingAiProviderOptionDto


## Properties

Name | Type
------------ | -------------
`id` | string
`name` | string
`provider` | string
`baseUrl` | string
`hasApiKey` | boolean
`supportsEmbedding` | boolean

## Example

```typescript
import type { EmbeddingAiProviderOptionDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "name": null,
  "provider": null,
  "baseUrl": null,
  "hasApiKey": null,
  "supportsEmbedding": null,
} satisfies EmbeddingAiProviderOptionDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as EmbeddingAiProviderOptionDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


