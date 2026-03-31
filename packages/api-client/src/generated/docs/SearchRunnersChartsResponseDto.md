
# SearchRunnersChartsResponseDto


## Properties

Name | Type
------------ | -------------
`totals` | [RunnersChartsTotalsDto](RunnersChartsTotalsDto.md)
`timeline` | [Array&lt;RunnersChartsTimelineBucketDto&gt;](RunnersChartsTimelineBucketDto.md)
`topSources` | [Array&lt;RunnersChartsTopSourceDto&gt;](RunnersChartsTopSourceDto.md)

## Example

```typescript
import type { SearchRunnersChartsResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "totals": null,
  "timeline": null,
  "topSources": null,
} satisfies SearchRunnersChartsResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SearchRunnersChartsResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


