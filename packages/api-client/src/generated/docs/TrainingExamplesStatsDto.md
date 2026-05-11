
# TrainingExamplesStatsDto


## Properties

Name | Type
------------ | -------------
`total` | number
`byLabel` | [{ [key: string]: TrainingExamplesStatsDtoByLabelValue; }](TrainingExamplesStatsDtoByLabelValue.md)

## Example

```typescript
import type { TrainingExamplesStatsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "total": null,
  "byLabel": null,
} satisfies TrainingExamplesStatsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as TrainingExamplesStatsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


