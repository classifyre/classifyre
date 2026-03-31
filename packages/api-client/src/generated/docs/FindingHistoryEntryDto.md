
# FindingHistoryEntryDto


## Properties

Name | Type
------------ | -------------
`timestamp` | Date
`runnerId` | string
`eventType` | string
`status` | string
`severity` | string
`confidence` | number
`location` | object
`changedBy` | string
`changeReason` | string

## Example

```typescript
import type { FindingHistoryEntryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "timestamp": null,
  "runnerId": null,
  "eventType": null,
  "status": null,
  "severity": null,
  "confidence": null,
  "location": null,
  "changedBy": null,
  "changeReason": null,
} satisfies FindingHistoryEntryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as FindingHistoryEntryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


