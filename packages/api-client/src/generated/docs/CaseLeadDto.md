
# CaseLeadDto


## Properties

Name | Type
------------ | -------------
`id` | string
`caseId` | string
`findingId` | string
`assetId` | string
`origin` | string
`status` | string
`rationale` | string
`title` | string
`importance` | number
`similarity` | number
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
  "origin": null,
  "status": null,
  "rationale": null,
  "title": null,
  "importance": null,
  "similarity": null,
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


