
# UpdateInstanceSettingsDto


## Properties

Name | Type
------------ | -------------
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
`autoScheduleEnabled` | boolean
`hfToken` | string
`harnessRunBudgetMinutes` | number
`harnessRunStaleAfterMinutes` | number
`harnessCycleBudgetMinutes` | number
`harnessEvidenceUsableFindings` | number
`harnessObservationChars` | number
`harnessTurnObservationChars` | number
`harnessMaxRankedFindings` | number
`harnessMaxGlossaryEntries` | number
`harnessMaxRecalledMemories` | number
`harnessDreamIntervalDays` | number
`harnessEvidenceUsableCoverage` | number
`harnessEvidenceWarnCoverage` | number
`harnessExpressImportance` | number

## Example

```typescript
import type { UpdateInstanceSettingsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "mcpEnabled": true,
  "language": ENGLISH,
  "timezone": America/New_York,
  "timeFormat": TWELVE_HOUR,
  "aiProviderConfigId": null,
  "harnessAiProviderConfigId": null,
  "autopilotInquiryEnabled": true,
  "autopilotCaseEnabled": true,
  "autopilotConfigEnabled": true,
  "autopilotDetectorEnabled": true,
  "autopilotEscalationEnabled": true,
  "autopilotMcpEnabled": true,
  "autoScheduleEnabled": true,
  "hfToken": null,
  "harnessRunBudgetMinutes": 20,
  "harnessRunStaleAfterMinutes": 60,
  "harnessCycleBudgetMinutes": 30,
  "harnessEvidenceUsableFindings": 2000,
  "harnessObservationChars": 8000,
  "harnessTurnObservationChars": 24000,
  "harnessMaxRankedFindings": 25,
  "harnessMaxGlossaryEntries": 20,
  "harnessMaxRecalledMemories": 30,
  "harnessDreamIntervalDays": 2,
  "harnessEvidenceUsableCoverage": 0.25,
  "harnessEvidenceWarnCoverage": 0.8,
  "harnessExpressImportance": 0.75,
} satisfies UpdateInstanceSettingsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UpdateInstanceSettingsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


