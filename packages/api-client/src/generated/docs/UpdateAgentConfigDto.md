
# UpdateAgentConfigDto


## Properties

Name | Type
------------ | -------------
`enabled` | boolean
`goal` | string
`maxIterations` | number
`toolNames` | Array&lt;string&gt;
`triggerMode` | string
`waitForMatching` | boolean
`waitForEvidence` | boolean
`waitForScans` | boolean
`minIntervalMinutes` | number
`maxStalenessHours` | number
`runBudgetMinutes` | number

## Example

```typescript
import type { UpdateAgentConfigDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "enabled": null,
  "goal": null,
  "maxIterations": null,
  "toolNames": null,
  "triggerMode": null,
  "waitForMatching": null,
  "waitForEvidence": null,
  "waitForScans": null,
  "minIntervalMinutes": null,
  "maxStalenessHours": null,
  "runBudgetMinutes": null,
} satisfies UpdateAgentConfigDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UpdateAgentConfigDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


