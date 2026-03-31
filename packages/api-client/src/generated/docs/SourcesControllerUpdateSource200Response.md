# SourcesControllerUpdateSource200Response

## Properties

| Name           | Type   |
| -------------- | ------ |
| `id`           | string |
| `name`         | string |
| `type`         | string |
| `config`       | object |
| `currentRunId` | string |
| `runnerStatus` | string |
| `createdAt`    | string |
| `updatedAt`    | string |

## Example

```typescript
import type { SourcesControllerUpdateSource200Response } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": a1b2c3d4-e5f6-7890-abcd-ef1234567890,
  "name": Updated Source Name,
  "type": WORDPRESS,
  "config": null,
  "currentRunId": null,
  "runnerStatus": PENDING,
  "createdAt": 2026-01-31T10:00:00.000Z,
  "updatedAt": 2026-01-31T11:00:00.000Z,
} satisfies SourcesControllerUpdateSource200Response

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SourcesControllerUpdateSource200Response
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)
