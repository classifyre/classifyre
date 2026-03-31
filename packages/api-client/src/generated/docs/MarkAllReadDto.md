
# MarkAllReadDto


## Properties

Name | Type
------------ | -------------
`type` | string
`event` | string
`severity` | string
`sourceId` | string
`runnerId` | string
`findingId` | string
`importantOnly` | boolean

## Example

```typescript
import type { MarkAllReadDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "type": null,
  "event": null,
  "severity": null,
  "sourceId": null,
  "runnerId": null,
  "findingId": null,
  "importantOnly": null,
} satisfies MarkAllReadDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as MarkAllReadDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


