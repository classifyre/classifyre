
# AgentRunDto


## Properties

Name | Type
------------ | -------------
`id` | string
`agentKind` | string
`status` | string
`sourceId` | string
`runnerId` | string
`trigger` | string
`attempts` | number
`error` | string
`summary` | string
`decisionCount` | number
`startedAt` | Date
`finishedAt` | Date
`createdAt` | Date

## Example

```typescript
import type { AgentRunDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "agentKind": null,
  "status": null,
  "sourceId": null,
  "runnerId": null,
  "trigger": null,
  "attempts": null,
  "error": null,
  "summary": null,
  "decisionCount": null,
  "startedAt": null,
  "finishedAt": null,
  "createdAt": null,
} satisfies AgentRunDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AgentRunDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


