
# InstanceSettingsResponseDto


## Properties

Name | Type
------------ | -------------
`id` | number
`aiEnabled` | boolean
`mcpEnabled` | boolean
`language` | string
`timezone` | string
`timeFormat` | string
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { InstanceSettingsResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": 1,
  "aiEnabled": true,
  "mcpEnabled": true,
  "language": ENGLISH,
  "timezone": UTC,
  "timeFormat": TWELVE_HOUR,
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


