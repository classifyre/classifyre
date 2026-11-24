
# CustomDetectorExtractionDto


## Properties

Name | Type
------------ | -------------
`id` | string
`findingId` | string
`customDetectorId` | string
`customDetectorKey` | string
`sourceId` | string
`assetId` | string
`runnerId` | string
`detectorVersion` | number
`pipelineResult` | object
`extractedAt` | Date
`createdAt` | Date

## Example

```typescript
import type { CustomDetectorExtractionDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "findingId": null,
  "customDetectorId": null,
  "customDetectorKey": null,
  "sourceId": null,
  "assetId": null,
  "runnerId": null,
  "detectorVersion": null,
  "pipelineResult": null,
  "extractedAt": null,
  "createdAt": null,
} satisfies CustomDetectorExtractionDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CustomDetectorExtractionDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


