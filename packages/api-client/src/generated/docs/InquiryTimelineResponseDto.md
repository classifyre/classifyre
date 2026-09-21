
# InquiryTimelineResponseDto


## Properties

Name | Type
------------ | -------------
`items` | [Array&lt;InquiryActivityDto&gt;](InquiryActivityDto.md)
`nextCursor` | string

## Example

```typescript
import type { InquiryTimelineResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "items": null,
  "nextCursor": null,
} satisfies InquiryTimelineResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as InquiryTimelineResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


