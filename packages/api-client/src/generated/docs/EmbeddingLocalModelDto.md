
# EmbeddingLocalModelDto


## Properties

Name | Type
------------ | -------------
`id` | string
`label` | string
`dimensions` | number
`pooling` | string
`mediaModalities` | Array&lt;string&gt;
`aliases` | Array&lt;string&gt;
`downloadMb` | [EmbeddingLocalModelDownloadDto](EmbeddingLocalModelDownloadDto.md)

## Example

```typescript
import type { EmbeddingLocalModelDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "label": null,
  "dimensions": null,
  "pooling": null,
  "mediaModalities": null,
  "aliases": null,
  "downloadMb": null,
} satisfies EmbeddingLocalModelDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as EmbeddingLocalModelDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


