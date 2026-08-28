
# RecordVerdictResponseDto


## Properties

Name | Type
------------ | -------------
`batchId` | string
`applied` | number
`skipped` | number
`workRemaining` | number

## Example

```typescript
import type { RecordVerdictResponseDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "batchId": null,
  "applied": null,
  "skipped": null,
  "workRemaining": null,
} satisfies RecordVerdictResponseDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as RecordVerdictResponseDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


