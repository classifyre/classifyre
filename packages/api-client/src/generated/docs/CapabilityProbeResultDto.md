
# CapabilityProbeResultDto


## Properties

Name | Type
------------ | -------------
`id` | string
`tier` | string
`title` | string
`whatItProves` | string
`status` | string
`reason` | string
`prompt` | string
`rawOutput` | string
`latencyMs` | number
`inputTokens` | number
`outputTokens` | number

## Example

```typescript
import type { CapabilityProbeResultDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": chain.two_step,
  "tier": CHAINING,
  "title": Carries an id from an observation into the next call,
  "whatItProves": null,
  "status": PASS,
  "reason": null,
  "prompt": null,
  "rawOutput": null,
  "latencyMs": 1840,
  "inputTokens": 2310,
  "outputTokens": 96,
} satisfies CapabilityProbeResultDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CapabilityProbeResultDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


