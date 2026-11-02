
# RunnerAssetFindingSummaryDto


## Properties

Name | Type
------------ | -------------
`id` | string
`detectorType` | string
`customDetectorKey` | string
`findingType` | string
`severity` | string
`status` | string
`assertedBySourceId` | string

## Example

```typescript
import type { RunnerAssetFindingSummaryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "detectorType": null,
  "customDetectorKey": null,
  "findingType": null,
  "severity": null,
  "status": null,
  "assertedBySourceId": null,
} satisfies RunnerAssetFindingSummaryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RunnerAssetFindingSummaryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


