
# UndoLogEntryDto


## Properties

Name | Type
------------ | -------------
`id` | string
`action` | string
`patternKey` | string
`pairCount` | number
`clusterCount` | number
`assetCount` | number
`summary` | string
`createdAt` | string
`undoneAt` | string
`undoable` | boolean

## Example

```typescript
import type { UndoLogEntryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "action": null,
  "patternKey": null,
  "pairCount": null,
  "clusterCount": null,
  "assetCount": null,
  "summary": null,
  "createdAt": null,
  "undoneAt": null,
  "undoable": null,
} satisfies UndoLogEntryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as UndoLogEntryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


