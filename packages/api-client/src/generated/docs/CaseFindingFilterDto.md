
# CaseFindingFilterDto


## Properties

Name | Type
------------ | -------------
`id` | string
`kind` | string
`action` | string
`pattern` | string
`description` | string
`inquiryId` | string
`inquiryTitle` | string
`createdBy` | string
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { CaseFindingFilterDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "kind": null,
  "action": null,
  "pattern": null,
  "description": null,
  "inquiryId": null,
  "inquiryTitle": null,
  "createdBy": null,
  "createdAt": null,
  "updatedAt": null,
} satisfies CaseFindingFilterDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseFindingFilterDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


