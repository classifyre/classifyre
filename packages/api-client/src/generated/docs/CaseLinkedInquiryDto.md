
# CaseLinkedInquiryDto


## Properties

Name | Type
------------ | -------------
`id` | string
`title` | string
`status` | string
`matchCount` | number

## Example

```typescript
import type { CaseLinkedInquiryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "title": null,
  "status": null,
  "matchCount": null,
} satisfies CaseLinkedInquiryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseLinkedInquiryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


