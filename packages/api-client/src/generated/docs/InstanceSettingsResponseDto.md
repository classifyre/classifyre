
# InstanceSettingsResponseDto


## Properties

Name | Type
------------ | -------------
`id` | number
`mcpEnabled` | boolean
`language` | string
`timezone` | string
`timeFormat` | string
`aiProviderConfigId` | string
`harnessAiProviderConfigId` | string
`autopilotInquiryEnabled` | boolean
`autopilotCaseEnabled` | boolean
`autopilotConfigEnabled` | boolean
`autopilotDetectorEnabled` | boolean
`autopilotEscalationEnabled` | boolean
`autopilotMcpEnabled` | boolean
`harnessRunBudgetMinutes` | number
`harnessRunStaleAfterMinutes` | number
`harnessCycleBudgetMinutes` | number
`harnessEvidenceUsableFindings` | number
`harnessEvidenceUsableCoverage` | number
`harnessEvidenceWarnCoverage` | number
`harnessExpressImportance` | number
`harnessObservationChars` | number
`harnessTurnObservationChars` | number
`harnessMaxRankedFindings` | number
`harnessMaxGlossaryEntries` | number
`harnessMaxRecalledMemories` | number
`harnessDreamIntervalDays` | number
`autoScheduleEnabled` | boolean
`demoMode` | boolean
`hfTokenSet` | boolean
`hfTokenInstanceSet` | boolean
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { InstanceSettingsResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": 1,
  "mcpEnabled": true,
  "language": ENGLISH,
  "timezone": AUTOMATIC,
  "timeFormat": TWELVE_HOUR,
  "aiProviderConfigId": null,
  "harnessAiProviderConfigId": null,
  "autopilotInquiryEnabled": true,
  "autopilotCaseEnabled": true,
  "autopilotConfigEnabled": true,
  "autopilotDetectorEnabled": true,
  "autopilotEscalationEnabled": true,
  "autopilotMcpEnabled": true,
  "harnessRunBudgetMinutes": 20,
  "harnessRunStaleAfterMinutes": 60,
  "harnessCycleBudgetMinutes": 30,
  "harnessEvidenceUsableFindings": 2000,
  "harnessEvidenceUsableCoverage": 0.25,
  "harnessEvidenceWarnCoverage": 0.8,
  "harnessExpressImportance": 0.75,
  "harnessObservationChars": 8000,
  "harnessTurnObservationChars": 24000,
  "harnessMaxRankedFindings": 25,
  "harnessMaxGlossaryEntries": 20,
  "harnessMaxRecalledMemories": 30,
  "harnessDreamIntervalDays": 2,
  "autoScheduleEnabled": true,
  "demoMode": false,
  "hfTokenSet": false,
  "hfTokenInstanceSet": false,
  "createdAt": null,
  "updatedAt": null,
} satisfies InstanceSettingsResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as InstanceSettingsResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


