
# AssistantCapabilityReportDto


## Properties

Name | Type
------------ | -------------
`configId` | string
`configName` | string
`provider` | string
`model` | string
`verdict` | string
`headline` | string
`abortedEarly` | boolean
`probes` | [Array&lt;CapabilityProbeResultDto&gt;](CapabilityProbeResultDto.md)
`agents` | [Array&lt;AgentCapacityReportDto&gt;](AgentCapacityReportDto.md)
`cost` | [CapabilityCostProjectionDto](CapabilityCostProjectionDto.md)
`totalInputTokens` | number
`totalOutputTokens` | number
`totalDurationMs` | number
`ranAt` | string
`assumptions` | Array&lt;string&gt;

## Example

```typescript
import type { AssistantCapabilityReportDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "configId": null,
  "configName": null,
  "provider": CLAUDE,
  "model": claude-sonnet-4-5,
  "verdict": READY,
  "headline": null,
  "abortedEarly": null,
  "probes": null,
  "agents": null,
  "cost": null,
  "totalInputTokens": null,
  "totalOutputTokens": null,
  "totalDurationMs": null,
  "ranAt": 2026-07-28T10:15:00.000Z,
  "assumptions": null,
} satisfies AssistantCapabilityReportDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AssistantCapabilityReportDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


