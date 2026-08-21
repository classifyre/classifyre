
# EmbeddingStatusResponseDto


## Properties

Name | Type
------------ | -------------
`enabled` | boolean
`pgvector` | boolean
`pgvectorVersion` | string
`searchStrategy` | string
`provider` | string
`model` | string
`dimensions` | number
`spaceId` | string
`persistentQueue` | boolean
`pendingQueueWrites` | number
`workerRegistered` | boolean
`autoBackfill` | boolean
`backfillRunning` | boolean
`backfillStartedAt` | string
`backfillCompletedAt` | string
`backfillError` | string
`recalibrationScheduled` | boolean
`recalibrationRunning` | boolean
`lastRecalibratedAt` | string
`lastRecalibrationError` | string
`embeddedRows` | number
`pendingEmbedJobs` | number
`embedJobFailureCount` | number
`lastEmbedJobError` | string
`lastEmbedJobErrorAt` | string
`lastEmbedSuccessAt` | string
`providerHealth` | [EmbeddingProviderHealthDto](EmbeddingProviderHealthDto.md)

## Example

```typescript
import type { EmbeddingStatusResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "enabled": null,
  "pgvector": null,
  "pgvectorVersion": null,
  "searchStrategy": null,
  "provider": null,
  "model": null,
  "dimensions": null,
  "spaceId": null,
  "persistentQueue": null,
  "pendingQueueWrites": null,
  "workerRegistered": null,
  "autoBackfill": null,
  "backfillRunning": null,
  "backfillStartedAt": null,
  "backfillCompletedAt": null,
  "backfillError": null,
  "recalibrationScheduled": null,
  "recalibrationRunning": null,
  "lastRecalibratedAt": null,
  "lastRecalibrationError": null,
  "embeddedRows": null,
  "pendingEmbedJobs": null,
  "embedJobFailureCount": null,
  "lastEmbedJobError": null,
  "lastEmbedJobErrorAt": null,
  "lastEmbedSuccessAt": null,
  "providerHealth": null,
} satisfies EmbeddingStatusResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as EmbeddingStatusResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


