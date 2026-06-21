
# AgentActivityItemDto


## Properties

Name | Type
------------ | -------------
`id` | string
`runId` | string
`agentKind` | string
`runStatus` | string
`action` | string
`outcome` | string
`entityType` | string
`entityId` | string
`rationale` | string
`payload` | object
`createdAt` | Date

## Example

```typescript
import type { AgentActivityItemDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "runId": null,
  "agentKind": null,
  "runStatus": null,
  "action": null,
  "outcome": null,
  "entityType": null,
  "entityId": null,
  "rationale": null,
  "payload": null,
  "createdAt": null,
} satisfies AgentActivityItemDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AgentActivityItemDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


