
# QuickSearchFindingDto


## Properties

Name | Type
------------ | -------------
`id` | string
`assetId` | string
`assetName` | string
`findingType` | string
`matchedContent` | string
`severity` | string
`detectorType` | string
`customDetectorName` | string
`status` | string

## Example

```typescript
import type { QuickSearchFindingDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "assetId": null,
  "assetName": null,
  "findingType": null,
  "matchedContent": null,
  "severity": null,
  "detectorType": null,
  "customDetectorName": null,
  "status": null,
} satisfies QuickSearchFindingDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as QuickSearchFindingDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


