
# CorrelationRecomputeNoteDto


## Properties

Name | Type
------------ | -------------
`scheduled` | boolean
`startsWithinSeconds` | number
`note` | string

## Example

```typescript
import type { CorrelationRecomputeNoteDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "scheduled": null,
  "startsWithinSeconds": null,
  "note": null,
} satisfies CorrelationRecomputeNoteDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CorrelationRecomputeNoteDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


