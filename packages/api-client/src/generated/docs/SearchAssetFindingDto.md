
# SearchAssetFindingDto


## Properties

Name | Type
------------ | -------------
`id` | string
`detectionIdentity` | string
`assetId` | string
`sourceId` | string
`runnerId` | string
`detectorType` | string
`customDetectorId` | string
`customDetectorKey` | string
`customDetectorName` | string
`findingType` | string
`category` | string
`severity` | string
`confidence` | number
`matchedContent` | string
`redactedContent` | string
`contextBefore` | string
`contextAfter` | string
`location` | [FindingLocationDto](FindingLocationDto.md)
`status` | string
`resolutionReason` | string
`comment` | string
`detectedAt` | Date
`firstDetectedAt` | Date
`lastDetectedAt` | Date
`resolvedAt` | Date
`createdAt` | Date
`updatedAt` | Date

## Example

```typescript
import type { SearchAssetFindingDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "detectionIdentity": null,
  "assetId": null,
  "sourceId": null,
  "runnerId": null,
  "detectorType": null,
  "customDetectorId": null,
  "customDetectorKey": null,
  "customDetectorName": null,
  "findingType": null,
  "category": null,
  "severity": null,
  "confidence": null,
  "matchedContent": null,
  "redactedContent": null,
  "contextBefore": null,
  "contextAfter": null,
  "location": null,
  "status": null,
  "resolutionReason": null,
  "comment": null,
  "detectedAt": null,
  "firstDetectedAt": null,
  "lastDetectedAt": null,
  "resolvedAt": null,
  "createdAt": null,
  "updatedAt": null,
} satisfies SearchAssetFindingDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SearchAssetFindingDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


