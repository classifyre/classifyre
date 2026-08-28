
# ReviewEgoGraphDto


## Properties

Name | Type
------------ | -------------
`nodes` | [Array&lt;ReviewEgoNodeDto&gt;](ReviewEgoNodeDto.md)
`edges` | [Array&lt;ReviewEgoEdgeDto&gt;](ReviewEgoEdgeDto.md)
`truncated` | number

## Example

```typescript
import type { ReviewEgoGraphDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "nodes": null,
  "edges": null,
  "truncated": null,
} satisfies ReviewEgoGraphDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ReviewEgoGraphDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


