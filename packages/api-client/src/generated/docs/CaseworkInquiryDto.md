
# CaseworkInquiryDto


## Properties

Name | Type
------------ | -------------
`id` | string
`title` | string
`matchCount` | number
`newMatchCount` | number
`updatedAt` | Date

## Example

```typescript
import type { CaseworkInquiryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "title": null,
  "matchCount": null,
  "newMatchCount": null,
  "updatedAt": null,
} satisfies CaseworkInquiryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseworkInquiryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


