
# CaseActivityDto


## Properties

Name | Type
------------ | -------------
`id` | string
`caseId` | string
`activityType` | string
`actor` | string
`payload` | object
`createdAt` | Date

## Example

```typescript
import type { CaseActivityDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "caseId": null,
  "activityType": null,
  "actor": null,
  "payload": null,
  "createdAt": null,
} satisfies CaseActivityDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseActivityDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


