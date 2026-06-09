
# PullFromQuestionDto


## Properties

Name | Type
------------ | -------------
`questionId` | string
`findingIds` | Array&lt;string&gt;

## Example

```typescript
import type { PullFromQuestionDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "questionId": null,
  "findingIds": null,
} satisfies PullFromQuestionDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as PullFromQuestionDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


