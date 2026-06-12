
# CreateHypothesisDto


## Properties

Name | Type
------------ | -------------
`statement` | string
`status` | string
`confidence` | number
`createdBy` | string

## Example

```typescript
import type { CreateHypothesisDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "statement": null,
  "status": null,
  "confidence": null,
  "createdBy": null,
} satisfies CreateHypothesisDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CreateHypothesisDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


