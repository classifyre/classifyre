# SourcesControllerStartRun200Response

## Properties

| Name           | Type   |
| -------------- | ------ |
| `id`           | string |
| `currentRunId` | string |
| `runnerStatus` | string |

## Example

```typescript
import type { SourcesControllerStartRun200Response } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "currentRunId": run_2026-01-31T10:00:00.000Z,
  "runnerStatus": PENDING,
} satisfies SourcesControllerStartRun200Response

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SourcesControllerStartRun200Response
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)
