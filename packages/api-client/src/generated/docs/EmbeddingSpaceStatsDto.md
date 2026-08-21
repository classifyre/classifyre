
# EmbeddingSpaceStatsDto


## Properties

Name | Type
------------ | -------------
`id` | string
`provider` | string
`model` | string
`revision` | string
`dimensions` | number
`pooling` | string
`normalized` | boolean
`isActive` | boolean
`vectors` | number
`createdAt` | string
`lastRecalibratedAt` | string

## Example

```typescript
import type { EmbeddingSpaceStatsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "provider": null,
  "model": null,
  "revision": null,
  "dimensions": null,
  "pooling": null,
  "normalized": null,
  "isActive": null,
  "vectors": null,
  "createdAt": null,
  "lastRecalibratedAt": null,
} satisfies EmbeddingSpaceStatsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as EmbeddingSpaceStatsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


