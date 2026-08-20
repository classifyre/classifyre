
# NotebookExecutionDto


## Properties

Name | Type
------------ | -------------
`id` | string
`sourceId` | string
`revision` | number
`mode` | string
`status` | string
`targetCellId` | string
`outputs` | object
`failedCellId` | string
`error` | object
`durationMs` | number
`createdAt` | Date
`startedAt` | Date
`finishedAt` | Date

## Example

```typescript
import type { NotebookExecutionDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "sourceId": null,
  "revision": null,
  "mode": null,
  "status": null,
  "targetCellId": null,
  "outputs": null,
  "failedCellId": null,
  "error": null,
  "durationMs": null,
  "createdAt": null,
  "startedAt": null,
  "finishedAt": null,
} satisfies NotebookExecutionDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as NotebookExecutionDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


