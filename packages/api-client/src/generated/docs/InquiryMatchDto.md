
# InquiryMatchDto


## Properties

Name | Type
------------ | -------------
`findingId` | string
`label` | string
`severity` | string
`detectorType` | string
`matchedContent` | string
`assetId` | string
`assetName` | string
`sourceType` | string
`matchedAt` | Date
`isNew` | boolean
`ranking` | [FindingSearchRankingDto](FindingSearchRankingDto.md)

## Example

```typescript
import type { InquiryMatchDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "findingId": null,
  "label": null,
  "severity": null,
  "detectorType": null,
  "matchedContent": null,
  "assetId": null,
  "assetName": null,
  "sourceType": null,
  "matchedAt": null,
  "isNew": null,
  "ranking": null,
} satisfies InquiryMatchDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as InquiryMatchDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


