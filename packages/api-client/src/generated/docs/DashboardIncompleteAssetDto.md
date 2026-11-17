
# DashboardIncompleteAssetDto


## Properties

Name | Type
------------ | -------------
`assetId` | string
`name` | string
`sourceId` | string
`sourceName` | string
`missing` | Array&lt;string&gt;

## Example

```typescript
import type { DashboardIncompleteAssetDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assetId": null,
  "name": null,
  "sourceId": null,
  "sourceName": null,
  "missing": null,
} satisfies DashboardIncompleteAssetDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as DashboardIncompleteAssetDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


