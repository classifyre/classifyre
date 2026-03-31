
# HealthControllerGetHealth200Response


## Properties

Name | Type
------------ | -------------
`status` | string
`timestamp` | string
`service` | string
`version` | string

## Example

```typescript
import type { HealthControllerGetHealth200Response } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "status": ok,
  "timestamp": 2026-01-31T10:00:00.000Z,
  "service": Classifyre API,
  "version": 1.0.0,
} satisfies HealthControllerGetHealth200Response

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as HealthControllerGetHealth200Response
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


