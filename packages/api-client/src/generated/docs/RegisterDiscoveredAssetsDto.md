
# RegisterDiscoveredAssetsDto


## Properties

Name | Type
------------ | -------------
`assetHashes` | Array&lt;string&gt;
`includeScanCache` | boolean
`includePayloadCursor` | boolean

## Example

```typescript
import type { RegisterDiscoveredAssetsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assetHashes": null,
  "includeScanCache": null,
  "includePayloadCursor": null,
} satisfies RegisterDiscoveredAssetsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RegisterDiscoveredAssetsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


