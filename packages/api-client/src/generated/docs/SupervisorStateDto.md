
# SupervisorStateDto


## Properties

Name | Type
------------ | -------------
`enabled` | boolean
`nextWakeAt` | Date
`wakeOnEvents` | Array&lt;string&gt;
`wakeReason` | string
`lastWakeAt` | Date
`pausedUntil` | Date
`consecutiveNoops` | number
`pendingEvents` | number
`activeGoals` | number
`budget` | [SupervisorBudgetDto](SupervisorBudgetDto.md)
`providerConfigured` | boolean

## Example

```typescript
import type { SupervisorStateDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "enabled": null,
  "nextWakeAt": null,
  "wakeOnEvents": null,
  "wakeReason": null,
  "lastWakeAt": null,
  "pausedUntil": null,
  "consecutiveNoops": null,
  "pendingEvents": null,
  "activeGoals": null,
  "budget": null,
  "providerConfigured": null,
} satisfies SupervisorStateDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SupervisorStateDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


