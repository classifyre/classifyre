
# CreateFindingDto


## Properties

Name | Type
------------ | -------------
`assetId` | string
`sourceId` | string
`runnerId` | string
`customDetectorId` | string
`customDetectorKey` | string
`customDetectorName` | string
`detectorType` | string
`findingType` | string
`category` | string
`severity` | string
`confidence` | number
`matchedContent` | string
`redactedContent` | string
`contextBefore` | string
`contextAfter` | string
`location` | [LocationDto](LocationDto.md)
`metadata` | object
`detectedAt` | Date

## Example

```typescript
import type { CreateFindingDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assetId": null,
  "sourceId": null,
  "runnerId": null,
  "customDetectorId": null,
  "customDetectorKey": null,
  "customDetectorName": null,
  "detectorType": null,
  "findingType": null,
  "category": null,
  "severity": null,
  "confidence": null,
  "matchedContent": null,
  "redactedContent": null,
  "contextBefore": null,
  "contextAfter": null,
  "location": null,
  "metadata": null,
  "detectedAt": null,
} satisfies CreateFindingDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CreateFindingDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


