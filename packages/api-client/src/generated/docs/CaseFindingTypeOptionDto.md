
# CaseFindingTypeOptionDto


## Properties

Name | Type
------------ | -------------
`findingType` | string
`detectorType` | string
`detectorName` | string
`inCase` | number
`answers` | number

## Example

```typescript
import type { CaseFindingTypeOptionDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "findingType": null,
  "detectorType": null,
  "detectorName": null,
  "inCase": null,
  "answers": null,
} satisfies CaseFindingTypeOptionDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CaseFindingTypeOptionDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


