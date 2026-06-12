
# CloseCaseResponseDto


## Properties

Name | Type
------------ | -------------
`_case` | [CaseResponseDto](CaseResponseDto.md)
`archivedInquiries` | number

## Example

```typescript
import type { CloseCaseResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "_case": null,
  "archivedInquiries": null,
} satisfies CloseCaseResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CloseCaseResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


