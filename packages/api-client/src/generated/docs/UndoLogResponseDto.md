
# UndoLogResponseDto


## Properties

Name | Type
------------ | -------------
`entries` | [Array&lt;UndoLogEntryDto&gt;](UndoLogEntryDto.md)

## Example

```typescript
import type { UndoLogResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "entries": null,
} satisfies UndoLogResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UndoLogResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


