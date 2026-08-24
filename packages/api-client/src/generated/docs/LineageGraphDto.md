
# LineageGraphDto


## Properties

Name | Type
------------ | -------------
`assetId` | string
`direction` | string
`depth` | number
`collapseContainers` | boolean
`mergeIdentity` | boolean

## Example

```typescript
import type { LineageGraphDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assetId": null,
  "direction": null,
  "depth": null,
  "collapseContainers": null,
  "mergeIdentity": null,
} satisfies LineageGraphDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as LineageGraphDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


