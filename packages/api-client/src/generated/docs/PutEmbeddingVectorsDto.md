
# PutEmbeddingVectorsDto


## Properties

Name | Type
------------ | -------------
`spaceId` | string
`items` | [Array&lt;EmbeddingVectorDto&gt;](EmbeddingVectorDto.md)

## Example

```typescript
import type { PutEmbeddingVectorsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "spaceId": null,
  "items": null,
} satisfies PutEmbeddingVectorsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as PutEmbeddingVectorsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


