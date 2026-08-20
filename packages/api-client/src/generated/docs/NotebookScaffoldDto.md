
# NotebookScaffoldDto


## Properties

Name | Type
------------ | -------------
`cells` | [Array&lt;NotebookCellDto&gt;](NotebookCellDto.md)
`requiredFunctions` | Array&lt;string&gt;
`optionalFunctions` | Array&lt;string&gt;

## Example

```typescript
import type { NotebookScaffoldDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "cells": null,
  "requiredFunctions": null,
  "optionalFunctions": null,
} satisfies NotebookScaffoldDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as NotebookScaffoldDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


