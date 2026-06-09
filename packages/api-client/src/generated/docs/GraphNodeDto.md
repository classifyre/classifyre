
# GraphNodeDto


## Properties

Name | Type
------------ | -------------
`id` | string
`type` | string
`label` | string
`depth` | number
`assetType` | string
`sourceType` | string
`severity` | string
`detectorType` | string
`status` | string
`matchedContent` | string
`assetName` | string
`assetId` | string
`hypothesisIds` | Array&lt;string&gt;
`caseFindingId` | string
`missing` | boolean

## Example

```typescript
import type { GraphNodeDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "type": null,
  "label": null,
  "depth": null,
  "assetType": null,
  "sourceType": null,
  "severity": null,
  "detectorType": null,
  "status": null,
  "matchedContent": null,
  "assetName": null,
  "assetId": null,
  "hypothesisIds": null,
  "caseFindingId": null,
  "missing": null,
} satisfies GraphNodeDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as GraphNodeDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


