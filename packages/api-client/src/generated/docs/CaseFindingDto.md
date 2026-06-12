
# CaseFindingDto


## Properties

Name | Type
------------ | -------------
`id` | string
`caseEvidenceId` | string
`findingId` | string
`findingLabel` | string
`severity` | string
`detectorType` | string
`customDetectorName` | string
`matchedContent` | string
`note` | string
`createdAt` | Date

## Example

```typescript
import type { CaseFindingDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "caseEvidenceId": null,
  "findingId": null,
  "findingLabel": null,
  "severity": null,
  "detectorType": null,
  "customDetectorName": null,
  "matchedContent": null,
  "note": null,
  "createdAt": null,
} satisfies CaseFindingDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseFindingDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


