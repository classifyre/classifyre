
# CaseEvidenceDto


## Properties

Name | Type
------------ | -------------
`id` | string
`entityType` | string
`entityId` | string
`note` | string
`addedBy` | string
`createdAt` | Date
`entity` | [EvidenceEntityDto](EvidenceEntityDto.md)
`findings` | [Array&lt;CaseFindingDto&gt;](CaseFindingDto.md)

## Example

```typescript
import type { CaseEvidenceDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "entityType": null,
  "entityId": null,
  "note": null,
  "addedBy": null,
  "createdAt": null,
  "entity": null,
  "findings": null,
} satisfies CaseEvidenceDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseEvidenceDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


