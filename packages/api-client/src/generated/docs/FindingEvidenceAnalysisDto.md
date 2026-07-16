
# FindingEvidenceAnalysisDto


## Properties

Name | Type
------------ | -------------
`spaceId` | string
`importanceScore` | number
`qualityScore` | number
`semanticOutlier` | number
`similarCount` | number
`duplicateGroupHash` | string
`reasons` | [Array&lt;FindingRankReasonDto&gt;](FindingRankReasonDto.md)
`signals` | { [key: string]: any; }
`analyzedAt` | Date

## Example

```typescript
import type { FindingEvidenceAnalysisDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "spaceId": null,
  "importanceScore": null,
  "qualityScore": null,
  "semanticOutlier": null,
  "similarCount": null,
  "duplicateGroupHash": null,
  "reasons": null,
  "signals": null,
  "analyzedAt": null,
} satisfies FindingEvidenceAnalysisDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as FindingEvidenceAnalysisDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


