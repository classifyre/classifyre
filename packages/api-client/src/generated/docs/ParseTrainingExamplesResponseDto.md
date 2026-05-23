
# ParseTrainingExamplesResponseDto


## Properties

Name | Type
------------ | -------------
`format` | string
`totalRows` | number
`importedRows` | number
`skippedRows` | number
`warnings` | Array&lt;string&gt;
`examples` | [Array&lt;ParsedTrainingExampleDto&gt;](ParsedTrainingExampleDto.md)
`availableColumns` | Array&lt;string&gt;
`detectedLabelColumn` | string
`detectedTextColumn` | string
`skippedReasons` | [ParseTrainingExamplesSkippedReasonsDto](ParseTrainingExamplesSkippedReasonsDto.md)

## Example

```typescript
import type { ParseTrainingExamplesResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "format": csv,
  "totalRows": null,
  "importedRows": null,
  "skippedRows": null,
  "warnings": null,
  "examples": null,
  "availableColumns": null,
  "detectedLabelColumn": null,
  "detectedTextColumn": null,
  "skippedReasons": null,
} satisfies ParseTrainingExamplesResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ParseTrainingExamplesResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


