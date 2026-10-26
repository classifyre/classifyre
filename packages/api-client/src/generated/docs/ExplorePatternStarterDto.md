
# ExplorePatternStarterDto


## Properties

Name | Type
------------ | -------------
`patternKey` | string
`labels` | Array&lt;string&gt;
`family` | string
`pairCount` | number
`assetCount` | number
`pair` | [Array&lt;ExploreAssetRefDto&gt;](ExploreAssetRefDto.md)

## Example

```typescript
import type { ExplorePatternStarterDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "patternKey": null,
  "labels": null,
  "family": null,
  "pairCount": null,
  "assetCount": null,
  "pair": null,
} satisfies ExplorePatternStarterDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ExplorePatternStarterDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


