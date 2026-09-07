
# ConstellationSourceDto


## Properties

Name | Type
------------ | -------------
`id` | string
`name` | string
`type` | string
`assetCount` | number
`connectedAssetCount` | number
`isolatedAssetCount` | number
`internalEdgeCount` | number
`findingCount` | number
`severityCounts` | [ConstellationSeverityMixDto](ConstellationSeverityMixDto.md)

## Example

```typescript
import type { ConstellationSourceDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "name": null,
  "type": null,
  "assetCount": null,
  "connectedAssetCount": null,
  "isolatedAssetCount": null,
  "internalEdgeCount": null,
  "findingCount": null,
  "severityCounts": null,
} satisfies ConstellationSourceDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ConstellationSourceDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


