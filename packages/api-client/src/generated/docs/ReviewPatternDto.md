
# ReviewPatternDto


## Properties

Name | Type
------------ | -------------
`patternKey` | string
`family` | string
`labels` | Array&lt;string&gt;
`pairCount` | number
`truePairCount` | number
`clusterCount` | number
`assetCount` | number
`avgWeighted` | number
`maxWeighted` | number
`scoreBuckets` | Array&lt;number&gt;
`decidedBuckets` | Array&lt;number&gt;
`clusterBuckets` | Array&lt;number&gt;
`lineagePathPairs` | number
`lineageNoPathPairs` | number
`lineageUnknownPairs` | number
`topologyShape` | string
`ruleKind` | string

## Example

```typescript
import type { ReviewPatternDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "patternKey": null,
  "family": null,
  "labels": null,
  "pairCount": null,
  "truePairCount": null,
  "clusterCount": null,
  "assetCount": null,
  "avgWeighted": null,
  "maxWeighted": null,
  "scoreBuckets": null,
  "decidedBuckets": null,
  "clusterBuckets": null,
  "lineagePathPairs": null,
  "lineageNoPathPairs": null,
  "lineageUnknownPairs": null,
  "topologyShape": null,
  "ruleKind": null,
} satisfies ReviewPatternDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ReviewPatternDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


