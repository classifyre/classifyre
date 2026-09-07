
# ConstellationResponseDto


## Properties

Name | Type
------------ | -------------
`sources` | [Array&lt;ConstellationSourceDto&gt;](ConstellationSourceDto.md)
`links` | [Array&lt;ConstellationLinkDto&gt;](ConstellationLinkDto.md)
`boundaryAssets` | [Array&lt;ConstellationBoundaryAssetDto&gt;](ConstellationBoundaryAssetDto.md)
`bundles` | [Array&lt;ConstellationBundleDto&gt;](ConstellationBundleDto.md)
`totals` | [ConstellationTotalsDto](ConstellationTotalsDto.md)
`stats` | [ConstellationStatsDto](ConstellationStatsDto.md)

## Example

```typescript
import type { ConstellationResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "sources": null,
  "links": null,
  "boundaryAssets": null,
  "bundles": null,
  "totals": null,
  "stats": null,
} satisfies ConstellationResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ConstellationResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


