
# BoardThreadSummaryDto


## Properties

Name | Type
------------ | -------------
`id` | string
`kind` | [CaseThreadKind](CaseThreadKind.md)
`title` | string
`status` | [HypothesisStatus](HypothesisStatus.md)
`confidence` | number
`color` | string
`createdBy` | string
`entryCount` | number
`lastEntryAt` | Date
`lastAuthor` | string
`lastExcerpt` | string
`supportingCount` | number
`contradictingCount` | number
`neutralCount` | number
`resolvedAt` | Date
`resolvedBy` | string
`itemId` | string
`onBoard` | boolean
`createdAt` | Date

## Example

```typescript
import type { BoardThreadSummaryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "kind": null,
  "title": null,
  "status": null,
  "confidence": null,
  "color": null,
  "createdBy": null,
  "entryCount": null,
  "lastEntryAt": null,
  "lastAuthor": null,
  "lastExcerpt": null,
  "supportingCount": null,
  "contradictingCount": null,
  "neutralCount": null,
  "resolvedAt": null,
  "resolvedBy": null,
  "itemId": null,
  "onBoard": null,
  "createdAt": null,
} satisfies BoardThreadSummaryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as BoardThreadSummaryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


