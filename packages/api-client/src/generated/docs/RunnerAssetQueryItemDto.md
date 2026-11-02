
# RunnerAssetQueryItemDto


## Properties

Name | Type
------------ | -------------
`id` | string
`assetHash` | string
`urn` | string
`sourceId` | string
`sourceName` | string
`externalId` | string
`name` | string
`kind` | string
`url` | string
`metadata` | object
`findings` | [Array&lt;RunnerAssetFindingSummaryDto&gt;](RunnerAssetFindingSummaryDto.md)

## Example

```typescript
import type { RunnerAssetQueryItemDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "assetHash": null,
  "urn": null,
  "sourceId": null,
  "sourceName": null,
  "externalId": null,
  "name": null,
  "kind": null,
  "url": null,
  "metadata": null,
  "findings": null,
} satisfies RunnerAssetQueryItemDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RunnerAssetQueryItemDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


