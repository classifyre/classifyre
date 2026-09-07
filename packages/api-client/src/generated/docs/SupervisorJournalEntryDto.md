
# SupervisorJournalEntryDto


## Properties

Name | Type
------------ | -------------
`id` | string
`runId` | string
`wakeReason` | string
`situation` | string
`did` | string
`next` | string
`goalIds` | Array&lt;string&gt;
`nextWakeAt` | Date
`costUsd` | number
`operatorNote` | string
`createdAt` | Date

## Example

```typescript
import type { SupervisorJournalEntryDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "runId": null,
  "wakeReason": null,
  "situation": null,
  "did": null,
  "next": null,
  "goalIds": null,
  "nextWakeAt": null,
  "costUsd": null,
  "operatorNote": null,
  "createdAt": null,
} satisfies SupervisorJournalEntryDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as SupervisorJournalEntryDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


