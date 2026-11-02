
# RunnerFindingQueryDto


## Properties

Name | Type
------------ | -------------
`detectorType` | Array&lt;string&gt;
`customDetectorKey` | Array&lt;string&gt;
`findingType` | Array&lt;string&gt;
`severity` | Array&lt;string&gt;
`status` | Array&lt;string&gt;
`sourceId` | Array&lt;string&gt;
`assetId` | Array&lt;string&gt;
`assertedBySourceId` | Array&lt;string&gt;
`limit` | number
`cursor` | string

## Example

```typescript
import type { RunnerFindingQueryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "detectorType": null,
  "customDetectorKey": null,
  "findingType": null,
  "severity": null,
  "status": null,
  "sourceId": null,
  "assetId": null,
  "assertedBySourceId": null,
  "limit": null,
  "cursor": null,
} satisfies RunnerFindingQueryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RunnerFindingQueryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


