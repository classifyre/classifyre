
# RunnerFindingItemDto


## Properties

Name | Type
------------ | -------------
`id` | string
`assetId` | string
`sourceId` | string
`detectorType` | string
`customDetectorKey` | string
`customDetectorName` | string
`findingType` | string
`category` | string
`severity` | string
`status` | string
`confidence` | number
`content` | string
`metadata` | object
`assertedBySourceId` | string
`firstDetectedAt` | string
`lastDetectedAt` | string

## Example

```typescript
import type { RunnerFindingItemDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "assetId": null,
  "sourceId": null,
  "detectorType": null,
  "customDetectorKey": null,
  "customDetectorName": null,
  "findingType": null,
  "category": null,
  "severity": null,
  "status": null,
  "confidence": null,
  "content": null,
  "metadata": null,
  "assertedBySourceId": null,
  "firstDetectedAt": null,
  "lastDetectedAt": null,
} satisfies RunnerFindingItemDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RunnerFindingItemDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


