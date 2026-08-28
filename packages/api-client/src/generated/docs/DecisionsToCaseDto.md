
# DecisionsToCaseDto


## Properties

Name | Type
------------ | -------------
`pairs` | [Array&lt;ReviewPairRefDto&gt;](ReviewPairRefDto.md)
`caseId` | string
`title` | string
`description` | string
`severity` | string
`attachFindings` | boolean

## Example

```typescript
import type { DecisionsToCaseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "pairs": null,
  "caseId": null,
  "title": null,
  "description": null,
  "severity": null,
  "attachFindings": null,
} satisfies DecisionsToCaseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as DecisionsToCaseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


