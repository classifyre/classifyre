
# CohortRunYieldDto


## Properties

Name | Type
------------ | -------------
`runnerId` | string
`triggeredAt` | Date
`bands` | object
`weightsUsed` | object

## Example

```typescript
import type { CohortRunYieldDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "runnerId": null,
  "triggeredAt": null,
  "bands": null,
  "weightsUsed": null,
} satisfies CohortRunYieldDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CohortRunYieldDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


