
# RunnerLogEntryDto


## Properties

Name | Type
------------ | -------------
`cursor` | string
`timestamp` | string
`stream` | string
`message` | string

## Example

```typescript
import type { RunnerLogEntryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "cursor": null,
  "timestamp": null,
  "stream": null,
  "message": null,
} satisfies RunnerLogEntryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RunnerLogEntryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


