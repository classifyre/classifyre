
# SupervisorGoalDto


## Properties

Name | Type
------------ | -------------
`id` | string
`kind` | string
`status` | string
`origin` | string
`title` | string
`body` | string
`priority` | number
`parentId` | string
`dueAt` | Date
`progress` | string
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { SupervisorGoalDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "kind": null,
  "status": null,
  "origin": null,
  "title": null,
  "body": null,
  "priority": null,
  "parentId": null,
  "dueAt": null,
  "progress": null,
  "createdAt": null,
  "updatedAt": null,
} satisfies SupervisorGoalDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SupervisorGoalDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


