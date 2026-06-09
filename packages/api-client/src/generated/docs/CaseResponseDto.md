
# CaseResponseDto


## Properties

Name | Type
------------ | -------------
`id` | string
`title` | string
`description` | string
`status` | string
`severity` | string
`assignee` | string
`createdBy` | string
`conclusion` | string
`evidenceCount` | number
`hypothesisCount` | number
`inquiryCount` | number
`createdAt` | Date
`updatedAt` | Date
`evidence` | [Array&lt;CaseEvidenceDto&gt;](CaseEvidenceDto.md)
`inquiries` | [Array&lt;CaseLinkedInquiryDto&gt;](CaseLinkedInquiryDto.md)

## Example

```typescript
import type { CaseResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "title": null,
  "description": null,
  "status": null,
  "severity": null,
  "assignee": null,
  "createdBy": null,
  "conclusion": null,
  "evidenceCount": null,
  "hypothesisCount": null,
  "inquiryCount": null,
  "createdAt": null,
  "updatedAt": null,
  "evidence": null,
  "inquiries": null,
} satisfies CaseResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


