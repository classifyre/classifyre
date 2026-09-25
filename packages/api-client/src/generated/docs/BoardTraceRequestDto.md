
# BoardTraceRequestDto


## Properties

Name | Type
------------ | -------------
`assetIds` | Array&lt;string&gt;
`direction` | [BoardTraceDirection](BoardTraceDirection.md)
`depth` | number
`kinds` | [Array&lt;BoardTraceKind&gt;](BoardTraceKind.md)
`limit` | number

## Example

```typescript
import type { BoardTraceRequestDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "assetIds": null,
  "direction": null,
  "depth": null,
  "kinds": null,
  "limit": null,
} satisfies BoardTraceRequestDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as BoardTraceRequestDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


