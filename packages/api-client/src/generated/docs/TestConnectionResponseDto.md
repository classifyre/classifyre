
# TestConnectionResponseDto


## Properties

Name | Type
------------ | -------------
`status` | string
`message` | string
`timestamp` | string
`sourceType` | string

## Example

```typescript
import type { TestConnectionResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "status": SUCCESS,
  "message": Successfully connected to Slack workspace acme.,
  "timestamp": 2026-02-04T14:22:11.123Z,
  "sourceType": SLACK,
} satisfies TestConnectionResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as TestConnectionResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


