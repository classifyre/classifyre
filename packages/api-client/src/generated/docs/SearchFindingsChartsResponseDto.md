
# SearchFindingsChartsResponseDto


## Properties

Name | Type
------------ | -------------
`totals` | [FindingsChartsTotalsDto](FindingsChartsTotalsDto.md)
`timeline` | [Array&lt;FindingsChartsTimelineBucketDto&gt;](FindingsChartsTimelineBucketDto.md)
`topAssets` | [Array&lt;FindingsChartsTopAssetDto&gt;](FindingsChartsTopAssetDto.md)

## Example

```typescript
import type { SearchFindingsChartsResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "totals": null,
  "timeline": null,
  "topAssets": null,
} satisfies SearchFindingsChartsResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SearchFindingsChartsResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


