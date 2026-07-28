
# AgentCapacityReportDto


## Properties

Name | Type
------------ | -------------
`kind` | string
`readiness` | string
`reason` | string
`maxIterations` | number
`toolCount` | number
`systemPromptTokens` | number
`projectedPeakTokens` | number
`contextSize` | number
`headroomPct` | number

## Example

```typescript
import type { AgentCapacityReportDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "kind": DETECTOR_AUTHOR,
  "readiness": READY,
  "reason": null,
  "maxIterations": 16,
  "toolCount": null,
  "systemPromptTokens": null,
  "projectedPeakTokens": null,
  "contextSize": null,
  "headroomPct": null,
} satisfies AgentCapacityReportDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AgentCapacityReportDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


