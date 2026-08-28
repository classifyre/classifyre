
# ReviewPairResponseDto


## Properties

Name | Type
------------ | -------------
`a` | [ReviewPairAssetDto](ReviewPairAssetDto.md)
`b` | [ReviewPairAssetDto](ReviewPairAssetDto.md)
`patternKey` | string
`weighted` | number
`labels` | Array&lt;string&gt;
`clusterId` | string
`fields` | [Array&lt;ReviewFieldRowDto&gt;](ReviewFieldRowDto.md)
`waterfall` | [ReviewWaterfallDto](ReviewWaterfallDto.md)
`ego` | [ReviewEgoGraphDto](ReviewEgoGraphDto.md)
`lineage` | [ReviewLineageEvidenceDto](ReviewLineageEvidenceDto.md)
`verdict` | string
`verdictStale` | boolean

## Example

```typescript
import type { ReviewPairResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "a": null,
  "b": null,
  "patternKey": null,
  "weighted": null,
  "labels": null,
  "clusterId": null,
  "fields": null,
  "waterfall": null,
  "ego": null,
  "lineage": null,
  "verdict": null,
  "verdictStale": null,
} satisfies ReviewPairResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ReviewPairResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


