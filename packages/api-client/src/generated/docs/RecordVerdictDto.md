
# RecordVerdictDto


## Properties

Name | Type
------------ | -------------
`pairs` | [Array&lt;ReviewPairRefDto&gt;](ReviewPairRefDto.md)
`verdict` | string
`note` | string

## Example

```typescript
import type { RecordVerdictDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "pairs": null,
  "verdict": null,
  "note": null,
} satisfies RecordVerdictDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RecordVerdictDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


