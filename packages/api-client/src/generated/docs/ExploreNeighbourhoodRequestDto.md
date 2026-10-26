
# ExploreNeighbourhoodRequestDto


## Properties

Name | Type
------------ | -------------
`assetIds` | Array&lt;string&gt;
`kinds` | [Array&lt;ExploreKind&gt;](ExploreKind.md)
`depth` | number
`direction` | string
`sourceId` | string
`scope` | string
`termId` | string
`duplicates` | [ExploreDuplicatesFilterDto](ExploreDuplicatesFilterDto.md)

## Example

```typescript
import type { ExploreNeighbourhoodRequestDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assetIds": null,
  "kinds": null,
  "depth": null,
  "direction": null,
  "sourceId": null,
  "scope": null,
  "termId": null,
  "duplicates": null,
} satisfies ExploreNeighbourhoodRequestDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ExploreNeighbourhoodRequestDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


