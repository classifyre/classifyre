
# ParsedTrainingExampleDto


## Properties

Name | Type
------------ | -------------
`label` | string
`text` | string
`accepted` | boolean
`source` | string
`lineNumber` | number

## Example

```typescript
import type { ParsedTrainingExampleDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "label": null,
  "text": null,
  "accepted": null,
  "source": null,
  "lineNumber": null,
} satisfies ParsedTrainingExampleDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ParsedTrainingExampleDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


