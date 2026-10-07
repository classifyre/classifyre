
# CaseHypothesisRuleDto


## Properties

Name | Type
------------ | -------------
`id` | string
`inquiryId` | string
`inquiryTitle` | string
`threadId` | string
`threadTitle` | string
`threadStatus` | string
`stance` | string
`kind` | string
`pattern` | string
`description` | string
`linkCount` | number
`createdBy` | string
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { CaseHypothesisRuleDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "inquiryId": null,
  "inquiryTitle": null,
  "threadId": null,
  "threadTitle": null,
  "threadStatus": null,
  "stance": null,
  "kind": null,
  "pattern": null,
  "description": null,
  "linkCount": null,
  "createdBy": null,
  "createdAt": null,
  "updatedAt": null,
} satisfies CaseHypothesisRuleDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseHypothesisRuleDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


