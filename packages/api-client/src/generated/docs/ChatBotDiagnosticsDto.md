
# ChatBotDiagnosticsDto


## Properties

Name | Type
------------ | -------------
`running` | boolean
`processing` | boolean
`connectedAt` | Date
`lastEventAt` | Date
`eventsReceived` | number
`repliesSent` | number
`lastError` | string
`activity` | [Array&lt;ChatBotActivityEntryDto&gt;](ChatBotActivityEntryDto.md)

## Example

```typescript
import type { ChatBotDiagnosticsDto } from '@workspace/api-client'

// TODO: Update the object below with actual values
const example = {
  "running": null,
  "processing": null,
  "connectedAt": null,
  "lastEventAt": null,
  "eventsReceived": null,
  "repliesSent": null,
  "lastError": null,
  "activity": null,
} satisfies ChatBotDiagnosticsDto

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ChatBotDiagnosticsDto
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


