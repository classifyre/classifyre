
# AgentUsageTotalsDto


## Properties

Name | Type
------------ | -------------
`runs` | number
`inputTokens` | number
`outputTokens` | number
`costUsd` | number
`avgDurationMs` | number

## Example

```typescript
import type { AgentUsageTotalsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "runs": null,
  "inputTokens": null,
  "outputTokens": null,
  "costUsd": null,
  "avgDurationMs": null,
} satisfies AgentUsageTotalsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AgentUsageTotalsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


