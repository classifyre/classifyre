
# WorkerQueueInstanceDto


## Properties

Name | Type
------------ | -------------
`instanceId` | string
`status` | string
`activeJobs` | number
`jobIds` | Array&lt;string&gt;
`startedAt` | string
`elapsedMs` | number
`lastFinishedAt` | string
`lastDurationMs` | number
`runCount` | number
`failureCount` | number
`lastError` | string
`lastErrorAt` | string
`heartbeatAt` | string

## Example

```typescript
import type { WorkerQueueInstanceDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "instanceId": classifyre-worker-7c9f8b6d4-2xkzq:1,
  "status": running,
  "activeJobs": 1,
  "jobIds": ["0f9c..."],
  "startedAt": null,
  "elapsedMs": null,
  "lastFinishedAt": null,
  "lastDurationMs": null,
  "runCount": 42,
  "failureCount": 0,
  "lastError": null,
  "lastErrorAt": null,
  "heartbeatAt": null,
} satisfies WorkerQueueInstanceDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as WorkerQueueInstanceDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


