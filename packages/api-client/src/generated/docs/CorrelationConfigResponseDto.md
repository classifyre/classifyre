
# CorrelationConfigResponseDto


## Properties

Name | Type
------------ | -------------
`defaultWeight` | number
`relatedMin` | number
`duplicateMin` | number
`labels` | [Array&lt;CorrelationLabelWeightDto&gt;](CorrelationLabelWeightDto.md)

## Example

```typescript
import type { CorrelationConfigResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "defaultWeight": null,
  "relatedMin": null,
  "duplicateMin": null,
  "labels": null,
} satisfies CorrelationConfigResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CorrelationConfigResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


