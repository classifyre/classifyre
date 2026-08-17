
# AgentConfigDto


## Properties

Name | Type
------------ | -------------
`kind` | string
`enabled` | boolean
`enableable` | boolean
`goal` | string
`defaultGoal` | string
`maxIterations` | number
`defaultMaxIterations` | number
`toolNames` | Array&lt;string&gt;
`defaultToolNames` | Array&lt;string&gt;
`mcpToolNames` | Array&lt;string&gt;
`triggerMode` | string
`defaultTriggerMode` | string
`waitForMatching` | boolean
`defaultWaitForMatching` | boolean
`waitForEvidence` | boolean
`defaultWaitForEvidence` | boolean
`waitForScans` | boolean
`defaultWaitForScans` | boolean
`minIntervalMinutes` | number
`defaultMinIntervalMinutes` | number
`maxStalenessHours` | number
`defaultMaxStalenessHours` | number
`runBudgetMinutes` | number
`lastTriggeredAt` | Date
`customized` | boolean

## Example

```typescript
import type { AgentConfigDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "kind": null,
  "enabled": null,
  "enableable": null,
  "goal": null,
  "defaultGoal": null,
  "maxIterations": null,
  "defaultMaxIterations": null,
  "toolNames": null,
  "defaultToolNames": null,
  "mcpToolNames": null,
  "triggerMode": null,
  "defaultTriggerMode": null,
  "waitForMatching": null,
  "defaultWaitForMatching": null,
  "waitForEvidence": null,
  "defaultWaitForEvidence": null,
  "waitForScans": null,
  "defaultWaitForScans": null,
  "minIntervalMinutes": null,
  "defaultMinIntervalMinutes": null,
  "maxStalenessHours": null,
  "defaultMaxStalenessHours": null,
  "runBudgetMinutes": null,
  "lastTriggeredAt": null,
  "customized": null,
} satisfies AgentConfigDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AgentConfigDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


