
# UpdateSupervisorDto


## Properties

Name | Type
------------ | -------------
`enabled` | boolean
`pausedUntil` | Date
`dailyCostLimitUsd` | number
`maxSleepHours` | number
`purgeBudgetPerDay` | number
`undoRetentionDays` | number

## Example

```typescript
import type { UpdateSupervisorDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "enabled": null,
  "pausedUntil": null,
  "dailyCostLimitUsd": null,
  "maxSleepHours": null,
  "purgeBudgetPerDay": null,
  "undoRetentionDays": null,
} satisfies UpdateSupervisorDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UpdateSupervisorDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


