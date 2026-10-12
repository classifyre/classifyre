
# AssetMediaChunkDto


## Properties

Name | Type
------------ | -------------
`modality` | string
`mimeType` | string
`data` | string
`page` | number

## Example

```typescript
import type { AssetMediaChunkDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "modality": null,
  "mimeType": image/jpeg,
  "data": null,
  "page": null,
} satisfies AssetMediaChunkDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AssetMediaChunkDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


