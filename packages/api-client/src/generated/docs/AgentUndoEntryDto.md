
# AgentUndoEntryDto


## Properties

Name | Type
------------ | -------------
`id` | string
`action` | string
`label` | string
`entityType` | string
`entityId` | string
`revertKind` | string
`createdAt` | Date
`expiresAt` | Date
`revertedAt` | Date
`revertedBy` | string
`undoable` | boolean
`blockedReason` | string

## Example

```typescript
import type { AgentUndoEntryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "action": null,
  "label": null,
  "entityType": null,
  "entityId": null,
  "revertKind": null,
  "createdAt": null,
  "expiresAt": null,
  "revertedAt": null,
  "revertedBy": null,
  "undoable": null,
  "blockedReason": null,
} satisfies AgentUndoEntryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AgentUndoEntryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


