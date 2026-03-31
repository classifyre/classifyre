
# FindingsDiscoveryTopAssetDto


## Properties

Name | Type
------------ | -------------
`assetId` | string
`assetName` | string
`assetType` | string
`sourceId` | string
`sourceName` | string
`sourceType` | string
`totalFindings` | number
`highestSeverity` | string
`lastDetectedAt` | Date

## Example

```typescript
import type { FindingsDiscoveryTopAssetDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assetId": null,
  "assetName": null,
  "assetType": null,
  "sourceId": null,
  "sourceName": null,
  "sourceType": null,
  "totalFindings": null,
  "highestSeverity": null,
  "lastDetectedAt": null,
} satisfies FindingsDiscoveryTopAssetDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as FindingsDiscoveryTopAssetDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


