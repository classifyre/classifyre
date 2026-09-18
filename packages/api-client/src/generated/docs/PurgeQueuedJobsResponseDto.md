
# PurgeQueuedJobsResponseDto


## Properties

Name | Type
------------ | -------------
`queue` | string
`droppedQueued` | number

## Example

```typescript
import type { PurgeQueuedJobsResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "queue": auto-schedule.tick,
  "droppedQueued": 3,
} satisfies PurgeQueuedJobsResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as PurgeQueuedJobsResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


