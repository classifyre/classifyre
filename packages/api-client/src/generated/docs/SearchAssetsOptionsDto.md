
# SearchAssetsOptionsDto


## Properties

Name | Type
------------ | -------------
`excludeFindings` | boolean
`includeAssetsWithoutFindings` | boolean

## Example

```typescript
import type { SearchAssetsOptionsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "excludeFindings": null,
  "includeAssetsWithoutFindings": null,
} satisfies SearchAssetsOptionsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SearchAssetsOptionsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


