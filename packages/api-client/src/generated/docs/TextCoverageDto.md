
# TextCoverageDto


## Properties

Name | Type
------------ | -------------
`extracted` | number
`empty` | number
`engineUnavailable` | number
`zeroFrames` | number
`failed` | number
`notApplicable` | number
`unknown` | number

## Example

```typescript
import type { TextCoverageDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "extracted": null,
  "empty": null,
  "engineUnavailable": null,
  "zeroFrames": null,
  "failed": null,
  "notApplicable": null,
  "unknown": null,
} satisfies TextCoverageDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as TextCoverageDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


