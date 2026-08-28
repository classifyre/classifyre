
# ReviewClusterRowDto


## Properties

Name | Type
------------ | -------------
`clusterId` | string
`patternKey` | string
`pairCount` | number
`undecidedPairs` | number
`memberCount` | number
`sourceCount` | number
`maxWeighted` | number
`avgWeighted` | number
`shape` | string
`lineageState` | string
`labels` | Array&lt;string&gt;
`sampleAssetIds` | Array&lt;string&gt;

## Example

```typescript
import type { ReviewClusterRowDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "clusterId": null,
  "patternKey": null,
  "pairCount": null,
  "undecidedPairs": null,
  "memberCount": null,
  "sourceCount": null,
  "maxWeighted": null,
  "avgWeighted": null,
  "shape": null,
  "lineageState": null,
  "labels": null,
  "sampleAssetIds": null,
} satisfies ReviewClusterRowDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ReviewClusterRowDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


