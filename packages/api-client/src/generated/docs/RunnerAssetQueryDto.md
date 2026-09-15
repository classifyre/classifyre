
# RunnerAssetQueryDto


## Properties

Name | Type
------------ | -------------
`source` | string
`kind` | string
`where` | object
`excludeVisited` | object
`select` | Array&lt;string&gt;
`limit` | number
`cursor` | string

## Example

```typescript
import type { RunnerAssetQueryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "source": null,
  "kind": null,
  "where": null,
  "excludeVisited": null,
  "select": null,
  "limit": null,
  "cursor": null,
} satisfies RunnerAssetQueryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RunnerAssetQueryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


