
# UpdateNotebookDto


## Properties

Name | Type
------------ | -------------
`baseRevision` | number
`cells` | [Array&lt;NotebookCellDto&gt;](NotebookCellDto.md)
`variables` | { [key: string]: string; }
`secrets` | { [key: string]: string | null; }

## Example

```typescript
import type { UpdateNotebookDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "baseRevision": null,
  "cells": null,
  "variables": null,
  "secrets": null,
} satisfies UpdateNotebookDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UpdateNotebookDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


