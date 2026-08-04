
# SitemapChunkDto


## Properties

Name | Type
------------ | -------------
`index` | number
`count` | number
`lastModified` | string

## Example

```typescript
import type { SitemapChunkDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "index": 0,
  "count": 10000,
  "lastModified": 2026-08-04T10:00:00.000Z,
} satisfies SitemapChunkDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SitemapChunkDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


