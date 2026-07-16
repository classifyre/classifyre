
# EmbeddingSpaceDto


## Properties

Name | Type
------------ | -------------
`model` | string
`revision` | string
`dim` | number
`pooling` | string
`normalized` | boolean

## Example

```typescript
import type { EmbeddingSpaceDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "model": null,
  "revision": null,
  "dim": null,
  "pooling": null,
  "normalized": null,
} satisfies EmbeddingSpaceDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as EmbeddingSpaceDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


