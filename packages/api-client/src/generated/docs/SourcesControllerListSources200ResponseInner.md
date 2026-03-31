# SourcesControllerListSources200ResponseInner

## Properties

| Name           | Type   |
| -------------- | ------ |
| `id`           | string |
| `name`         | string |
| `type`         | string |
| `runnerStatus` | string |
| `createdAt`    | string |

## Example

```typescript
import type { SourcesControllerListSources200ResponseInner } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": a1b2c3d4-e5f6-7890-abcd-ef1234567890,
  "name": Production WordPress,
  "type": WORDPRESS,
  "runnerStatus": COMPLETED,
  "createdAt": 2026-01-31T10:00:00.000Z,
} satisfies SourcesControllerListSources200ResponseInner

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SourcesControllerListSources200ResponseInner
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)
