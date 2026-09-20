
# ReferencingFindingDto


## Properties

Name | Type
------------ | -------------
`findingId` | string
`severity` | string
`status` | string
`findingType` | string
`matchedContent` | string
`detectedAt` | Date
`viaAssetId` | string
`viaAssetName` | string
`relationType` | string

## Example

```typescript
import type { ReferencingFindingDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "findingId": null,
  "severity": null,
  "status": null,
  "findingType": null,
  "matchedContent": null,
  "detectedAt": null,
  "viaAssetId": null,
  "viaAssetName": null,
  "relationType": null,
} satisfies ReferencingFindingDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ReferencingFindingDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


