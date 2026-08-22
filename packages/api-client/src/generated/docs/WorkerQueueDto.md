
# WorkerQueueDto


## Properties

Name | Type
------------ | -------------
`queue` | string
`status` | string
`paused` | boolean
`activeJobs` | number
`queuedCount` | number
`deferredCount` | number
`totalCount` | number
`runCount` | number
`failureCount` | number
`lastError` | string
`lastErrorAt` | string
`instances` | [Array&lt;WorkerQueueInstanceDto&gt;](WorkerQueueInstanceDto.md)

## Example

```typescript
import type { WorkerQueueDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "queue": embedding,
  "status": idle,
  "paused": false,
  "activeJobs": 0,
  "queuedCount": 26000,
  "deferredCount": 0,
  "totalCount": 26000,
  "runCount": 128,
  "failureCount": 2,
  "lastError": null,
  "lastErrorAt": null,
  "instances": null,
} satisfies WorkerQueueDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as WorkerQueueDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


