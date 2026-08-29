
# UpdateSupervisorGoalDto


## Properties

Name | Type
------------ | -------------
`title` | string
`body` | string
`status` | string
`priority` | number
`progress` | string
`dueAt` | Date

## Example

```typescript
import type { UpdateSupervisorGoalDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "title": null,
  "body": null,
  "status": null,
  "priority": null,
  "progress": null,
  "dueAt": null,
} satisfies UpdateSupervisorGoalDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UpdateSupervisorGoalDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


