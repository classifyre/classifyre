
# DecisionsToInquiryResponseDto


## Properties

Name | Type
------------ | -------------
`inquiryId` | string
`title` | string
`matchCount` | number
`pairsLinked` | number

## Example

```typescript
import type { DecisionsToInquiryResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "inquiryId": null,
  "title": null,
  "matchCount": null,
  "pairsLinked": null,
} satisfies DecisionsToInquiryResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as DecisionsToInquiryResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


