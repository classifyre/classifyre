
# FindingSearchRankingDto


## Properties

Name | Type
------------ | -------------
`importance` | number
`quality` | number
`similarCount` | number
`duplicateGroupHash` | string
`reasons` | [Array&lt;FindingRankReasonDto&gt;](FindingRankReasonDto.md)
`coverage` | string
`reciprocalRank` | number
`semanticSimilarity` | number

## Example

```typescript
import type { FindingSearchRankingDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "importance": null,
  "quality": null,
  "similarCount": null,
  "duplicateGroupHash": null,
  "reasons": null,
  "coverage": null,
  "reciprocalRank": null,
  "semanticSimilarity": null,
} satisfies FindingSearchRankingDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as FindingSearchRankingDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


