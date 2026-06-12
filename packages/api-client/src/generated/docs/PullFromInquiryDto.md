
# PullFromInquiryDto


## Properties

Name | Type
------------ | -------------
`inquiryId` | string
`findingIds` | Array&lt;string&gt;

## Example

```typescript
import type { PullFromInquiryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "inquiryId": null,
  "findingIds": null,
} satisfies PullFromInquiryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as PullFromInquiryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


