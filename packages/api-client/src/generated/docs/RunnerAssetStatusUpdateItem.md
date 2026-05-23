
# RunnerAssetStatusUpdateItem


## Properties

Name | Type
------------ | -------------
`assetHash` | string
`status` | string
`errorMessage` | string
`findingsTotal` | number
`findingsBySeverity` | [FindingsBySeverityDto](FindingsBySeverityDto.md)
`findingsByDetector` | object

## Example

```typescript
import type { RunnerAssetStatusUpdateItem } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assetHash": null,
  "status": null,
  "errorMessage": null,
  "findingsTotal": null,
  "findingsBySeverity": null,
  "findingsByDetector": null,
} satisfies RunnerAssetStatusUpdateItem

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RunnerAssetStatusUpdateItem
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


