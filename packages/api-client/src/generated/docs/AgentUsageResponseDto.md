
# AgentUsageResponseDto


## Properties

Name | Type
------------ | -------------
`buckets` | [Array&lt;AgentUsageBucketDto&gt;](AgentUsageBucketDto.md)
`totals` | [AgentUsageTotalsDto](AgentUsageTotalsDto.md)
`pricingConfigured` | boolean

## Example

```typescript
import type { AgentUsageResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "buckets": null,
  "totals": null,
  "pricingConfigured": null,
} satisfies AgentUsageResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as AgentUsageResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


