
# AutopilotStatsDto


## Properties

Name | Type
------------ | -------------
`totalRuns` | number
`runsLast24h` | number
`activeRuns` | number
`decisionsApplied` | number
`decisionsSkipped` | number
`decisionsFailed` | number
`memoryCount` | number
`briefVersion` | number
`lastActivityAt` | Date
`runsByKind` | { [key: string]: number; }

## Example

```typescript
import type { AutopilotStatsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "totalRuns": null,
  "runsLast24h": null,
  "activeRuns": null,
  "decisionsApplied": null,
  "decisionsSkipped": null,
  "decisionsFailed": null,
  "memoryCount": null,
  "briefVersion": null,
  "lastActivityAt": null,
  "runsByKind": null,
} satisfies AutopilotStatsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AutopilotStatsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


