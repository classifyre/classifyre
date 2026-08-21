
# NotebookTemplateDto


## Properties

Name | Type
------------ | -------------
`name` | string
`description` | string
`cells` | [Array&lt;NotebookCellDto&gt;](NotebookCellDto.md)

## Example

```typescript
import type { NotebookTemplateDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "name": null,
  "description": null,
  "cells": null,
} satisfies NotebookTemplateDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as NotebookTemplateDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


