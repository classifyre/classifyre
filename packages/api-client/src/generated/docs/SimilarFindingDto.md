
# SimilarFindingDto


## Properties

Name | Type
------------ | -------------
`id` | string
`findingType` | string
`severity` | string
`status` | string
`matchedContent` | string
`similarity` | number
`confidence` | number
`assetId` | string
`sourceId` | string
`asset` | [SimilarFindingAssetDto](SimilarFindingAssetDto.md)
`source` | [SimilarFindingSourceDto](SimilarFindingSourceDto.md)
`evidenceAnalysis` | [SimilarFindingEvidenceAnalysisDto](SimilarFindingEvidenceAnalysisDto.md)

## Example

```typescript
import type { SimilarFindingDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "findingType": null,
  "severity": null,
  "status": null,
  "matchedContent": null,
  "similarity": null,
  "confidence": null,
  "assetId": null,
  "sourceId": null,
  "asset": null,
  "source": null,
  "evidenceAnalysis": null,
} satisfies SimilarFindingDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SimilarFindingDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


