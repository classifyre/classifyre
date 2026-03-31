
# FindingsChartsTopAssetDto


## Properties

Name | Type
------------ | -------------
`assetId` | string
`assetName` | string
`sourceId` | string
`sourceName` | string
`totalFindings` | number
`highestSeverity` | string

## Example

```typescript
import type { FindingsChartsTopAssetDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assetId": null,
  "assetName": null,
  "sourceId": null,
  "sourceName": null,
  "totalFindings": null,
  "highestSeverity": null,
} satisfies FindingsChartsTopAssetDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as FindingsChartsTopAssetDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


