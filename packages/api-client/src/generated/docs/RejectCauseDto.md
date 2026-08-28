
# RejectCauseDto


## Properties

Name | Type
------------ | -------------
`drivers` | [Array&lt;RejectCauseLabelDto&gt;](RejectCauseLabelDto.md)
`dominantLabel` | string
`similarPairs` | number

## Example

```typescript
import type { RejectCauseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "drivers": null,
  "dominantLabel": null,
  "similarPairs": null,
} satisfies RejectCauseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RejectCauseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


