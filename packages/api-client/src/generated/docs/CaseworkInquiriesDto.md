
# CaseworkInquiriesDto


## Properties

Name | Type
------------ | -------------
`byStatus` | [CaseworkInquiryStatusBreakdownDto](CaseworkInquiryStatusBreakdownDto.md)
`total` | number
`newMatchTotal` | number
`withNewMatches` | [Array&lt;CaseworkInquiryDto&gt;](CaseworkInquiryDto.md)

## Example

```typescript
import type { CaseworkInquiriesDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "byStatus": null,
  "total": null,
  "newMatchTotal": null,
  "withNewMatches": null,
} satisfies CaseworkInquiriesDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseworkInquiriesDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


