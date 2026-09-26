
# QuickSearchAssetDto


## Properties

Name | Type
------------ | -------------
`id` | string
`name` | string
`externalUrl` | string
`assetType` | string
`sourceType` | string
`sourceId` | string
`sourceName` | string
`openFindings` | number
`severityCounts` | [QuickSearchSeverityCountsDto](QuickSearchSeverityCountsDto.md)

## Example

```typescript
import type { QuickSearchAssetDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "name": null,
  "externalUrl": null,
  "assetType": null,
  "sourceType": null,
  "sourceId": null,
  "sourceName": null,
  "openFindings": null,
  "severityCounts": null,
} satisfies QuickSearchAssetDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as QuickSearchAssetDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


