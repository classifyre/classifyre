
# ConstellationBundleDto


## Properties

Name | Type
------------ | -------------
`id` | string
`sourceAId` | string
`sourceBId` | string
`assetCount` | number
`edgeCount` | number

## Example

```typescript
import type { ConstellationBundleDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "sourceAId": null,
  "sourceBId": null,
  "assetCount": null,
  "edgeCount": null,
} satisfies ConstellationBundleDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ConstellationBundleDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


