
# NotebookCellDto


## Properties

Name | Type
------------ | -------------
`id` | string
`type` | string
`source` | string

## Example

```typescript
import type { NotebookCellDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": extract,
  "type": null,
  "source": null,
} satisfies NotebookCellDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as NotebookCellDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


