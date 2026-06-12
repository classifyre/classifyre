
# CaseQuestionDto


## Properties

Name | Type
------------ | -------------
`id` | string
`title` | string
`status` | string
`evidenceCount` | number
`hypothesisCount` | number
`matchCount` | number
`createdAt` | Date

## Example

```typescript
import type { CaseQuestionDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "title": null,
  "status": null,
  "evidenceCount": null,
  "hypothesisCount": null,
  "matchCount": null,
  "createdAt": null,
} satisfies CaseQuestionDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseQuestionDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


