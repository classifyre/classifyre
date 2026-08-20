
# CreateNotebookExecutionDto


## Properties

Name | Type
------------ | -------------
`revision` | number
`mode` | string
`targetCellId` | string
`maxAssets` | number

## Example

```typescript
import type { CreateNotebookExecutionDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "revision": null,
  "mode": null,
  "targetCellId": null,
  "maxAssets": null,
} satisfies CreateNotebookExecutionDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CreateNotebookExecutionDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


