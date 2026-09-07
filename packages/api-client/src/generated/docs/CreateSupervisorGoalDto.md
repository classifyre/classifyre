
# CreateSupervisorGoalDto


## Properties

Name | Type
------------ | -------------
`title` | string
`body` | string
`kind` | string
`priority` | number
`parentId` | string
`dueAt` | Date

## Example

```typescript
import type { CreateSupervisorGoalDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "title": null,
  "body": null,
  "kind": null,
  "priority": null,
  "parentId": null,
  "dueAt": null,
} satisfies CreateSupervisorGoalDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CreateSupervisorGoalDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


