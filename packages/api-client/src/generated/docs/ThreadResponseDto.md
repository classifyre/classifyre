
# ThreadResponseDto


## Properties

Name | Type
------------ | -------------
`id` | string
`caseId` | string
`kind` | string
`title` | string
`status` | string
`confidence` | number
`color` | string
`createdBy` | string
`supportingCount` | number
`contradictingCount` | number
`links` | [Array&lt;ThreadSupportLinkDto&gt;](ThreadSupportLinkDto.md)
`entries` | [Array&lt;ThreadEntryDto&gt;](ThreadEntryDto.md)
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { ThreadResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "caseId": null,
  "kind": null,
  "title": null,
  "status": null,
  "confidence": null,
  "color": null,
  "createdBy": null,
  "supportingCount": null,
  "contradictingCount": null,
  "links": null,
  "entries": null,
  "createdAt": null,
  "updatedAt": null,
} satisfies ThreadResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ThreadResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


