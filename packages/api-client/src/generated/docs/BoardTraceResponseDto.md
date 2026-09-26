
# BoardTraceResponseDto


## Properties

Name | Type
------------ | -------------
`nodes` | [Array&lt;BoardTraceNodeDto&gt;](BoardTraceNodeDto.md)
`edges` | [Array&lt;BoardTraceEdgeDto&gt;](BoardTraceEdgeDto.md)
`truncated` | boolean

## Example

```typescript
import type { BoardTraceResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "nodes": null,
  "edges": null,
  "truncated": null,
} satisfies BoardTraceResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as BoardTraceResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


