
# SitemapSectionDto


## Properties

Name | Type
------------ | -------------
`type` | string
`total` | number
`lastModified` | string
`chunks` | [Array&lt;SitemapChunkDto&gt;](SitemapChunkDto.md)

## Example

```typescript
import type { SitemapSectionDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "type": null,
  "total": null,
  "lastModified": null,
  "chunks": null,
} satisfies SitemapSectionDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SitemapSectionDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


