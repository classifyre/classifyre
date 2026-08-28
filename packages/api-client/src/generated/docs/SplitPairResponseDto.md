
# SplitPairResponseDto


## Properties

Name | Type
------------ | -------------
`batchId` | string
`clusterSplit` | boolean
`workRemaining` | number

## Example

```typescript
import type { SplitPairResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "batchId": null,
  "clusterSplit": null,
  "workRemaining": null,
} satisfies SplitPairResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SplitPairResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


