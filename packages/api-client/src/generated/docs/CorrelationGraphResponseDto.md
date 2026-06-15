
# CorrelationGraphResponseDto


## Properties

Name | Type
------------ | -------------
`nodes` | [Array&lt;GraphNodeDto&gt;](GraphNodeDto.md)
`edges` | [Array&lt;GraphEdgeDto&gt;](GraphEdgeDto.md)
`truncated` | boolean
`similarities` | [Array&lt;AssetSimilarityDto&gt;](AssetSimilarityDto.md)

## Example

```typescript
import type { CorrelationGraphResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "nodes": null,
  "edges": null,
  "truncated": null,
  "similarities": null,
} satisfies CorrelationGraphResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CorrelationGraphResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


