
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
`autopilotInquiryDesired` | string
`autopilotInquirySearchable` | string
`autopilotCaseEnabled` | boolean
`autopilotCaseGuidance` | string
`autopilotConfigEnabled` | boolean
`autopilotConfigGuidance` | string
`autopilotDetectorEnabled` | boolean
`autopilotDetectorGuidance` | string
`autopilotEscalationEnabled` | boolean
`autopilotEscalationGuidance` | string
`autopilotMcpEnabled` | boolean
`autoScheduleEnabled` | boolean
`maxConcurrentRunners` | number
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
  "autopilotInquiryDesired": null,
  "autopilotInquirySearchable": null,
  "autopilotCaseEnabled": true,
  "autopilotCaseGuidance": null,
  "autopilotConfigEnabled": true,
  "autopilotConfigGuidance": null,
  "autopilotDetectorEnabled": true,
  "autopilotDetectorGuidance": null,
  "autopilotEscalationEnabled": true,
  "autopilotEscalationGuidance": null,
  "autopilotMcpEnabled": true,
  "autoScheduleEnabled": true,
  "maxConcurrentRunners": 2,
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


