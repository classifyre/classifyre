
# PatternPreviewResponseDto


## Properties

Name | Type
------------ | -------------
`patternKey` | string
`pairsAffected` | number
`clustersAffected` | number
`assetsAffected` | number
`sampleClusterIds` | Array&lt;string&gt;
`ruleKind` | string
`ruleDescription` | string
`workRemainingBefore` | number
`workRemainingAfter` | number

## Example

```typescript
import type { PatternPreviewResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "patternKey": null,
  "pairsAffected": null,
  "clustersAffected": null,
  "assetsAffected": null,
  "sampleClusterIds": null,
  "ruleKind": null,
  "ruleDescription": null,
  "workRemainingBefore": null,
  "workRemainingAfter": null,
} satisfies PatternPreviewResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as PatternPreviewResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


