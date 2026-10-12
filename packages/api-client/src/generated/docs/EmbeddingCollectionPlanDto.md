
# EmbeddingCollectionPlanDto


## Properties

Name | Type
------------ | -------------
`chunks` | boolean
`media` | [Array&lt;EmbeddingCollectionMediaDto&gt;](EmbeddingCollectionMediaDto.md)

## Example

```typescript
import type { EmbeddingCollectionPlanDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "chunks": null,
  "media": null,
} satisfies EmbeddingCollectionPlanDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as EmbeddingCollectionPlanDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


