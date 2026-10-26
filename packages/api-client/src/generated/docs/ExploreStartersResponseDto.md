
# ExploreStartersResponseDto


## Properties

Name | Type
------------ | -------------
`lineage` | [Array&lt;ExploreLineageStarterDto&gt;](ExploreLineageStarterDto.md)
`patterns` | [Array&lt;ExplorePatternStarterDto&gt;](ExplorePatternStarterDto.md)
`links` | [Array&lt;ExploreLinkStarterDto&gt;](ExploreLinkStarterDto.md)

## Example

```typescript
import type { ExploreStartersResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "lineage": null,
  "patterns": null,
  "links": null,
} satisfies ExploreStartersResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ExploreStartersResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


