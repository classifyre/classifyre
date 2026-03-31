
# SearchAssetsChartsTopAssetDto


## Properties

Name | Type
------------ | -------------
`assetId` | string
`assetName` | string
`findingsCount` | number
`severityScore` | number
`highestSeverity` | string
`sourceId` | string

## Example

```typescript
import type { SearchAssetsChartsTopAssetDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assetId": null,
  "assetName": null,
  "findingsCount": null,
  "severityScore": null,
  "highestSeverity": null,
  "sourceId": null,
} satisfies SearchAssetsChartsTopAssetDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SearchAssetsChartsTopAssetDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


