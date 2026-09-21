
# RunnerQueuePositionDto


## Properties

Name | Type
------------ | -------------
`runnerId` | string
`status` | string
`positionInNamespace` | number
`priority` | boolean
`runningNow` | number
`concurrencyLimit` | number
`reason` | string

## Example

```typescript
import type { RunnerQueuePositionDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "runnerId": null,
  "status": null,
  "positionInNamespace": null,
  "priority": null,
  "runningNow": null,
  "concurrencyLimit": null,
  "reason": null,
} satisfies RunnerQueuePositionDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RunnerQueuePositionDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


