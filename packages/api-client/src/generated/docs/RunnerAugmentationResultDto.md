
# RunnerAugmentationResultDto


## Properties

Name | Type
------------ | -------------
`written` | number
`skipped` | number
`dropped` | number

## Example

```typescript
import type { RunnerAugmentationResultDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "written": null,
  "skipped": null,
  "dropped": null,
} satisfies RunnerAugmentationResultDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RunnerAugmentationResultDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


