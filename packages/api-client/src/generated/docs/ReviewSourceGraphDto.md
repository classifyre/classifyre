
# ReviewSourceGraphDto


## Properties

Name | Type
------------ | -------------
`nodes` | [Array&lt;ReviewSourceNodeDto&gt;](ReviewSourceNodeDto.md)
`edges` | [Array&lt;ReviewSourceEdgeDto&gt;](ReviewSourceEdgeDto.md)
`topShare` | number

## Example

```typescript
import type { ReviewSourceGraphDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "nodes": null,
  "edges": null,
  "topShare": null,
} satisfies ReviewSourceGraphDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ReviewSourceGraphDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


