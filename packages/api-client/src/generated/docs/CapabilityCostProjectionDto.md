
# CapabilityCostProjectionDto


## Properties

Name | Type
------------ | -------------
`avgInputTokensPerTurn` | number
`avgOutputTokensPerTurn` | number
`estimatedCostPerRunUsd` | number
`basedOnAgent` | string

## Example

```typescript
import type { CapabilityCostProjectionDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "avgInputTokensPerTurn": null,
  "avgOutputTokensPerTurn": null,
  "estimatedCostPerRunUsd": null,
  "basedOnAgent": null,
} satisfies CapabilityCostProjectionDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CapabilityCostProjectionDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


