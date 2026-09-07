
# AgentUndoListDto


## Properties

Name | Type
------------ | -------------
`entries` | [Array&lt;AgentUndoEntryDto&gt;](AgentUndoEntryDto.md)

## Example

```typescript
import type { AgentUndoListDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "entries": null,
} satisfies AgentUndoListDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AgentUndoListDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


