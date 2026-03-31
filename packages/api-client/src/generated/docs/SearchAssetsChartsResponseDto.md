
# SearchAssetsChartsResponseDto


## Properties

Name | Type
------------ | -------------
`totals` | [SearchAssetsChartsTotalsDto](SearchAssetsChartsTotalsDto.md)
`topAssetsByFindings` | [Array&lt;SearchAssetsChartsTopAssetDto&gt;](SearchAssetsChartsTopAssetDto.md)
`topSourcesByAssetVolume` | [Array&lt;SearchAssetsChartsTopSourceDto&gt;](SearchAssetsChartsTopSourceDto.md)

## Example

```typescript
import type { SearchAssetsChartsResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "totals": null,
  "topAssetsByFindings": null,
  "topSourcesByAssetVolume": null,
} satisfies SearchAssetsChartsResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SearchAssetsChartsResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


