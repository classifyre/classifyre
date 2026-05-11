
# SaveTrainingExamplesDto


## Properties

Name | Type
------------ | -------------
`examples` | [Array&lt;TrainingExampleItemDto&gt;](TrainingExampleItemDto.md)
`clearExisting` | boolean

## Example

```typescript
import type { SaveTrainingExamplesDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "examples": null,
  "clearExisting": null,
} satisfies SaveTrainingExamplesDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SaveTrainingExamplesDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


