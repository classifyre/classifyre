
# AgentRunDetailDto


## Properties

Name | Type
------------ | -------------
`id` | string
`agentKind` | string
`status` | string
`sourceId` | string
`runnerId` | string
`caseId` | string
`trigger` | string
`instruction` | string
`attempts` | number
`error` | string
`summary` | string
`decisionCount` | number
`startedAt` | Date
`finishedAt` | Date
`createdAt` | Date
`decisions` | [Array&lt;AgentDecisionDto&gt;](AgentDecisionDto.md)

## Example

```typescript
import type { AgentRunDetailDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "agentKind": null,
  "status": null,
  "sourceId": null,
  "runnerId": null,
  "caseId": null,
  "trigger": null,
  "instruction": null,
  "attempts": null,
  "error": null,
  "summary": null,
  "decisionCount": null,
  "startedAt": null,
  "finishedAt": null,
  "createdAt": null,
  "decisions": null,
} satisfies AgentRunDetailDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AgentRunDetailDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


