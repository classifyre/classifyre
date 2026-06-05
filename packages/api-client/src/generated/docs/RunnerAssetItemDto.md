
# RunnerAssetItemDto


## Properties

Name | Type
------------ | -------------
`runnerId` | string
`assetHash` | string
`status` | string
`startedAt` | Date
`completedAt` | Date
`errorMessage` | string
`createdAt` | Date
`findingsTotal` | number
`findingsBySeverity` | object
`findingsByDetector` | object
`metadata` | { [key: string]: any; }
`asset` | [AssetListItemDto](AssetListItemDto.md)

## Example

```typescript
import type { RunnerAssetItemDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "runnerId": null,
  "assetHash": null,
  "status": null,
  "startedAt": null,
  "completedAt": null,
  "errorMessage": null,
  "createdAt": null,
  "findingsTotal": null,
  "findingsBySeverity": null,
  "findingsByDetector": null,
  "metadata": null,
  "asset": null,
} satisfies RunnerAssetItemDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RunnerAssetItemDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


