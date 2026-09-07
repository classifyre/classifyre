
# SupervisorBudgetDto


## Properties

Name | Type
------------ | -------------
`spentTodayUsd` | number
`limitUsd` | number
`remainingUsd` | number
`exhausted` | boolean
`wakesToday` | number
`purgesToday` | number
`purgeBudgetPerDay` | number

## Example

```typescript
import type { SupervisorBudgetDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "spentTodayUsd": null,
  "limitUsd": null,
  "remainingUsd": null,
  "exhausted": null,
  "wakesToday": null,
  "purgesToday": null,
  "purgeBudgetPerDay": null,
} satisfies SupervisorBudgetDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SupervisorBudgetDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


