
# UpdateInstanceSettingsDto


## Properties

Name | Type
------------ | -------------
`aiEnabled` | boolean
`mcpEnabled` | boolean
`language` | string
`timezone` | string
`timeFormat` | string
`aiProviderConfigId` | string
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
`hfToken` | string

## Example

```typescript
import type { UpdateInstanceSettingsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "aiEnabled": true,
  "mcpEnabled": true,
  "language": ENGLISH,
  "timezone": America/New_York,
  "timeFormat": TWELVE_HOUR,
  "aiProviderConfigId": null,
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
  "hfToken": null,
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


