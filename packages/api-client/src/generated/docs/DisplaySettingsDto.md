
# DisplaySettingsDto


## Properties

Name | Type
------------ | -------------
`language` | string
`timezone` | string
`timeFormat` | string

## Example

```typescript
import type { DisplaySettingsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "language": ENGLISH,
  "timezone": AUTOMATIC,
  "timeFormat": TWELVE_HOUR,
} satisfies DisplaySettingsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as DisplaySettingsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


