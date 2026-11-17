
# QualityDayDto


## Properties

Name | Type
------------ | -------------
`day` | string
`passed` | number
`failed` | number

## Example

```typescript
import type { QualityDayDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "day": 2026-11-17,
  "passed": null,
  "failed": null,
} satisfies QualityDayDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as QualityDayDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


