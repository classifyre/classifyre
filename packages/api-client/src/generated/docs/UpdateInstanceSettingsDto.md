
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

## Example

```typescript
import type { UpdateInstanceSettingsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "aiEnabled": false,
  "mcpEnabled": false,
  "language": ENGLISH,
  "timezone": America/New_York,
  "timeFormat": TWELVE_HOUR,
  "aiProviderConfigId": null,
  "autopilotInquiryEnabled": false,
  "autopilotInquiryDesired": null,
  "autopilotInquirySearchable": null,
  "autopilotCaseEnabled": false,
  "autopilotCaseGuidance": null,
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


