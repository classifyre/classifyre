
# CaseLeadDto


## Properties

Name | Type
------------ | -------------
`id` | string
`caseId` | string
`findingId` | string
`assetId` | string
`kind` | string
`state` | string
`origin` | string
`status` | string
`rationale` | string
`title` | string
`importance` | number
`similarity` | number
`viaFindingId` | string
`viaAssetId` | string
`viaInquiryId` | string
`viaLabel` | string
`viaAssetName` | string
`details` | { [key: string]: any; }
`findingType` | string
`value` | string
`severity` | string
`findingStatus` | string
`assetName` | string
`assetType` | string
`sourceType` | string
`sourceName` | string
`proposedBy` | string
`reviewedBy` | string
`reviewedAt` | Date
`createdAt` | Date

## Example

```typescript
import type { CaseLeadDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "caseId": null,
  "findingId": null,
  "assetId": null,
  "kind": null,
  "state": null,
  "origin": null,
  "status": null,
  "rationale": null,
  "title": null,
  "importance": null,
  "similarity": null,
  "viaFindingId": null,
  "viaAssetId": null,
  "viaInquiryId": null,
  "viaLabel": null,
  "viaAssetName": null,
  "details": null,
  "findingType": null,
  "value": null,
  "severity": null,
  "findingStatus": null,
  "assetName": null,
  "assetType": null,
  "sourceType": null,
  "sourceName": null,
  "proposedBy": null,
  "reviewedBy": null,
  "reviewedAt": null,
  "createdAt": null,
} satisfies CaseLeadDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseLeadDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


