
# ReviewSampleResponseDto


## Properties

Name | Type
------------ | -------------
`pairs` | [Array&lt;ReviewSamplePairDto&gt;](ReviewSamplePairDto.md)
`undecidedTotal` | number

## Example

```typescript
import type { ReviewSampleResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "pairs": null,
  "undecidedTotal": null,
} satisfies ReviewSampleResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ReviewSampleResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


