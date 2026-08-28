
# ReviewSamplePairDto


## Properties

Name | Type
------------ | -------------
`aId` | string
`bId` | string
`aName` | string
`bName` | string
`weighted` | number
`lineageState` | string
`labels` | Array&lt;string&gt;
`sharedValues` | Array&lt;string&gt;
`clusterId` | string

## Example

```typescript
import type { ReviewSamplePairDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "aId": null,
  "bId": null,
  "aName": null,
  "bName": null,
  "weighted": null,
  "lineageState": null,
  "labels": null,
  "sharedValues": null,
  "clusterId": null,
} satisfies ReviewSamplePairDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ReviewSamplePairDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


