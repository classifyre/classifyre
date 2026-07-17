
# CaseEventDto


## Properties

Name | Type
------------ | -------------
`id` | string
`caseId` | string
`occurredAt` | Date
`precision` | string
`title` | string
`description` | string
`confidence` | number
`origin` | string
`verified` | boolean
`verifiedBy` | string
`findingIds` | Array&lt;string&gt;
`evidenceIds` | Array&lt;string&gt;
`createdBy` | string
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { CaseEventDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "caseId": null,
  "occurredAt": null,
  "precision": null,
  "title": null,
  "description": null,
  "confidence": null,
  "origin": null,
  "verified": null,
  "verifiedBy": null,
  "findingIds": null,
  "evidenceIds": null,
  "createdBy": null,
  "createdAt": null,
  "updatedAt": null,
} satisfies CaseEventDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseEventDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


