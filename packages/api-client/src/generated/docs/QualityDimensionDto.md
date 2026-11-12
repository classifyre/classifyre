
# QualityDimensionDto


## Properties

Name | Type
------------ | -------------
`dimension` | string
`score` | number
`rules` | number

## Example

```typescript
import type { QualityDimensionDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "dimension": null,
  "score": null,
  "rules": null,
} satisfies QualityDimensionDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as QualityDimensionDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


