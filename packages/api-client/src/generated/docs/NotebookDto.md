
# NotebookDto


## Properties

Name | Type
------------ | -------------
`revision` | number
`cells` | [Array&lt;NotebookCellDto&gt;](NotebookCellDto.md)
`variables` | { [key: string]: string; }
`secretKeys` | Array&lt;string&gt;
`contract` | object

## Example

```typescript
import type { NotebookDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "revision": null,
  "cells": null,
  "variables": null,
  "secretKeys": null,
  "contract": null,
} satisfies NotebookDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as NotebookDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


