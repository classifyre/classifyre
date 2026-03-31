
# RunnerDto


## Properties

Name | Type
------------ | -------------
`id` | string
`sourceId` | string
`triggeredBy` | string
`triggeredAt` | Date
`triggerType` | string
`status` | string
`executionMode` | string
`startedAt` | Date
`completedAt` | Date
`durationMs` | number
`recipe` | object
`detectors` | object
`assetsCreated` | number
`assetsUpdated` | number
`assetsUnchanged` | number
`assetsDeleted` | number
`totalFindings` | number
`errorMessage` | string
`errorDetails` | object
`jobName` | string
`jobNamespace` | string
`source` | [SourceInfoDto](SourceInfoDto.md)

## Example

```typescript
import type { RunnerDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "sourceId": null,
  "triggeredBy": null,
  "triggeredAt": null,
  "triggerType": null,
  "status": null,
  "executionMode": null,
  "startedAt": null,
  "completedAt": null,
  "durationMs": null,
  "recipe": null,
  "detectors": null,
  "assetsCreated": null,
  "assetsUpdated": null,
  "assetsUnchanged": null,
  "assetsDeleted": null,
  "totalFindings": null,
  "errorMessage": null,
  "errorDetails": null,
  "jobName": null,
  "jobNamespace": null,
  "source": null,
} satisfies RunnerDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RunnerDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


