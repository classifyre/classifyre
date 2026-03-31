
# CustomDetectorTrainingRunDto


## Properties

Name | Type
------------ | -------------
`id` | string
`customDetectorId` | string
`sourceId` | string
`status` | string
`strategy` | string
`startedAt` | Date
`completedAt` | Date
`durationMs` | number
`trainedExamples` | number
`positiveExamples` | number
`negativeExamples` | number
`metrics` | { [key: string]: any; }
`modelArtifactPath` | string
`configHash` | string
`errorMessage` | string
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { CustomDetectorTrainingRunDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "customDetectorId": null,
  "sourceId": null,
  "status": null,
  "strategy": null,
  "startedAt": null,
  "completedAt": null,
  "durationMs": null,
  "trainedExamples": null,
  "positiveExamples": null,
  "negativeExamples": null,
  "metrics": null,
  "modelArtifactPath": null,
  "configHash": null,
  "errorMessage": null,
  "createdAt": null,
  "updatedAt": null,
} satisfies CustomDetectorTrainingRunDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CustomDetectorTrainingRunDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


