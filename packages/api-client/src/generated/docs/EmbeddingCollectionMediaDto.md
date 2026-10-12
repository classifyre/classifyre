
# EmbeddingCollectionMediaDto


## Properties

Name | Type
------------ | -------------
`modality` | string
`mimeType` | string
`maxItems` | number
`cacheKey` | string
`fingerprint` | string
`maxEdge` | number
`quality` | number
`sampleRate` | number
`clipSeconds` | number

## Example

```typescript
import type { EmbeddingCollectionMediaDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "modality": null,
  "mimeType": image/jpeg,
  "maxItems": null,
  "cacheKey": EMBED_MEDIA::image,
  "fingerprint": null,
  "maxEdge": null,
  "quality": null,
  "sampleRate": null,
  "clipSeconds": null,
} satisfies EmbeddingCollectionMediaDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as EmbeddingCollectionMediaDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


