
# UpdateCaseHypothesisRuleDto


## Properties

Name | Type
------------ | -------------
`threadId` | string
`stance` | string
`kind` | string
`pattern` | string
`description` | string
`updateLinks` | boolean

## Example

```typescript
import type { UpdateCaseHypothesisRuleDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "threadId": null,
  "stance": null,
  "kind": null,
  "pattern": null,
  "description": null,
  "updateLinks": null,
} satisfies UpdateCaseHypothesisRuleDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UpdateCaseHypothesisRuleDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


