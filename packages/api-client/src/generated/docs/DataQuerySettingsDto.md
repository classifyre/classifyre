
# DataQuerySettingsDto


## Properties

Name | Type
------------ | -------------
`enabled` | boolean
`maxRows` | number
`timeoutSeconds` | number
`exportMaxRows` | number
`updatedBy` | string
`updatedAt` | Date

## Example

```typescript
import type { DataQuerySettingsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "enabled": null,
  "maxRows": null,
  "timeoutSeconds": null,
  "exportMaxRows": null,
  "updatedBy": null,
  "updatedAt": null,
} satisfies DataQuerySettingsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as DataQuerySettingsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


