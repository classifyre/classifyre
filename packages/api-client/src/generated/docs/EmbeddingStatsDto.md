
# EmbeddingStatsDto


## Properties

Name | Type
------------ | -------------
`spaces` | [Array&lt;EmbeddingSpaceStatsDto&gt;](EmbeddingSpaceStatsDto.md)
`vectors` | number
`vectorsAllSpaces` | number
`storageBytes` | number
`analysisStorageBytes` | number
`chunks` | number
`embeddableFindings` | number
`rankedFindings` | number

## Example

```typescript
import type { EmbeddingStatsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "spaces": null,
  "vectors": null,
  "vectorsAllSpaces": null,
  "storageBytes": null,
  "analysisStorageBytes": null,
  "chunks": null,
  "embeddableFindings": null,
  "rankedFindings": null,
} satisfies EmbeddingStatsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as EmbeddingStatsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


