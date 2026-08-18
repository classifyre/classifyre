
# NotebookSessionDto


## Properties

Name | Type
------------ | -------------
`id` | string
`status` | string
`path` | string
`error` | string
`startedAt` | Date

## Example

```typescript
import type { NotebookSessionDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "status": null,
  "path": null,
  "error": null,
  "startedAt": null,
} satisfies NotebookSessionDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as NotebookSessionDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


