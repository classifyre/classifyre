
# CaseworkSummaryDto


## Properties

Name | Type
------------ | -------------
`cases` | [CaseworkCasesDto](CaseworkCasesDto.md)
`inquiries` | [CaseworkInquiriesDto](CaseworkInquiriesDto.md)
`leads` | [CaseworkLeadsDto](CaseworkLeadsDto.md)

## Example

```typescript
import type { CaseworkSummaryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "cases": null,
  "inquiries": null,
  "leads": null,
} satisfies CaseworkSummaryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseworkSummaryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


