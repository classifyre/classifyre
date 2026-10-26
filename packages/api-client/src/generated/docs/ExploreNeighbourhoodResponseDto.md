
# ExploreNeighbourhoodResponseDto


## Properties

Name | Type
------------ | -------------
`seeds` | Array&lt;string&gt;
`home` | Array&lt;string&gt;
`nodes` | [Array&lt;ExploreNodeDto&gt;](ExploreNodeDto.md)
`terms` | [Array&lt;ExploreTermDto&gt;](ExploreTermDto.md)
`edges` | [Array&lt;ExploreEdgeDto&gt;](ExploreEdgeDto.md)
`counts` | { [key: string]: number; }
`alike` | string
`truncated` | boolean
`cases` | [Array&lt;ExploreMarkDto&gt;](ExploreMarkDto.md)
`inquiries` | [Array&lt;ExploreMarkDto&gt;](ExploreMarkDto.md)

## Example

```typescript
import type { ExploreNeighbourhoodResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "seeds": null,
  "home": null,
  "nodes": null,
  "terms": null,
  "edges": null,
  "counts": null,
  "alike": null,
  "truncated": null,
  "cases": null,
  "inquiries": null,
} satisfies ExploreNeighbourhoodResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ExploreNeighbourhoodResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


